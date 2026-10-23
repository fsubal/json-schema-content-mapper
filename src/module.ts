import { basename, dirname, relative, resolve } from "node:path";
import { TextBuilder, type SpanMapping } from "./builder.js";
import { detectDocument, type DialectDefaults } from "./dialect.js";
import { TypeInferrer } from "./infer.js";
import { formatKey, writeLiteralType } from "./literal.js";
import { escapePointerToken, parseSchemaFile, type KeySpans, type Problem } from "./parse.js";
import { standardJsonSchemaText } from "./standard-json-schema.js";

export interface ModuleOptions extends DialectDefaults {
  strictObjects: boolean;
}

export interface MappedModule {
  text: string;
  mappings: SpanMapping[];
  problems: Problem[];
}

/** The extensions this mapper reads; the file's own name comes before them. */
const SCHEMA_EXTENSION_RE = /(?:\.schema)?\.(?:ya?ml|jsonc)$/;

const RESERVED_SCHEMA_NAMES = ["Schema", "Type", "StandardJSONSchema"];
const RESERVED_OPERATION_NAMES = [
  "Schema",
  "PathParams",
  "QueryParams",
  "HeaderParams",
  "CookieParams",
  "RequestBody",
  "Responses",
  "Response",
];

/** Where each kind of document keeps its named definitions. */
const DEFINITION_CONTAINERS = {
  schema: ["/$defs", "/definitions"],
  "openapi-document": ["/components/schemas"],
  "openapi-operation": [],
} as const;

/** `user_profile` → `UserProfile`; a name no identifier can start with gets a leading `_`. */
export function pascalCase(name: string): string {
  const words = name.split(/[^A-Za-z0-9$]+/).filter(Boolean);
  const joined = words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join("");
  if (joined === "") return "_";
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
}

/** `_show.schema.yaml` → `Show`: the alias a schema file exports for its `Type`. */
export function fileTypeName(fileName: string): string {
  return pascalCase(basename(fileName).replace(SCHEMA_EXTENSION_RE, ""));
}

function reservedNames(fileName: string, kind: keyof typeof DEFINITION_CONTAINERS): Set<string> {
  return new Set(kind === "schema" ? [...RESERVED_SCHEMA_NAMES, fileTypeName(fileName)] : RESERVED_OPERATION_NAMES);
}

/**
 * The exported name of a definition. It depends only on the definition's own
 * name and the file's name, so a `$ref` from another file can name it
 * without reading this one.
 */
export function definitionTypeName(definition: string, reserved: ReadonlySet<string>): string {
  const name = pascalCase(definition);
  return reserved.has(name) ? `${name}Def` : name;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The import specifier, relative to `fromFile`, of a `$ref`'s file. */
function importSpecifier(fromFile: string, refFile: string): string {
  const target = relative(dirname(fromFile), resolve(dirname(fromFile), refFile)).replaceAll("\\", "/");
  return target.startsWith(".") ? target : `./${target}`;
}

/** The type an external `$ref` names, as exported by the referenced file's own virtual module. */
function externalRefType(fromFile: string, refFile: string, fragment: string): string | undefined {
  const specifier = JSON.stringify(importSpecifier(fromFile, refFile));
  if (fragment === "" || fragment === "/") return `import(${specifier}).Type`;
  const match = /^\/(?:\$defs|definitions|components\/schemas)\/([^/]+)$/.exec(fragment);
  if (!match) return undefined;
  const definition = match[1]!.replaceAll("~1", "/").replaceAll("~0", "~");
  const reserved = reservedNames(refFile, fragment.startsWith("/components/") ? "openapi-document" : "schema");
  return `import(${specifier}).${definitionTypeName(definition, reserved)}`;
}

/** Types for a file that failed to parse: the parse errors are the error, and every use of the module stays quiet. */
const FAILED_MODULE = "export type Schema = any;\nexport type Type = any;\n";

/** Builds the virtual TypeScript module standing in for a schema file. */
export function mapSchemaFile(fileName: string, content: string, options: ModuleOptions): MappedModule {
  const parsed = parseSchemaFile(fileName, content);
  if (!parsed.ok) {
    return { text: FAILED_MODULE, mappings: [], problems: parsed.problems };
  }
  const { value, keys } = parsed;
  const document = detectDocument(value, options);
  const reserved = reservedNames(fileName, document.kind);

  const definitions: { name: string; pointer: string }[] = [];
  for (const container of DEFINITION_CONTAINERS[document.kind]) {
    const defs = resolveContainer(value, container);
    for (const definition of Object.keys(defs)) {
      definitions.push({
        name: definitionTypeName(definition, reserved),
        pointer: `${container}/${escapePointerToken(definition)}`,
      });
    }
  }
  const namedPointers = new Map(definitions.map(({ name, pointer }) => [pointer, name]));
  if (document.kind === "schema") namedPointers.set("", "Type");

  const inferrer = new TypeInferrer(value, keys, {
    dialect: document.dialect,
    strictObjects: options.strictObjects,
    namedPointers,
    externalRef: (file, fragment) => externalRefType(fileName, file, fragment),
  });

  const out = new TextBuilder();
  out.write(`// Types of ${basename(fileName)} (${document.kind}, ${document.dialect}), by json-schema-content-mapper.\n\n`);
  out.write("/** The schema itself, as `as const` would type it. */\nexport type Schema = ");
  writeLiteralType(out, value, "", keys, 0);
  out.write(";\n\n");

  if (document.kind === "schema") {
    out.write("/** The data this schema accepts. */\nexport type Type = ").append(inferrer.infer("")).write(";\n\n");
    const alias = fileTypeName(fileName);
    if (!RESERVED_SCHEMA_NAMES.includes(alias)) out.write(`export type ${alias} = Type;\n\n`);
  } else if (document.kind === "openapi-operation") {
    writeOperation(out, value as Record<string, unknown>, keys, inferrer);
  }

  for (const { name, pointer } of definitions) {
    out.write("export type ").writeMapped(name, keys.get(pointer)).write(" = ").append(inferrer.infer(pointer)).write(";\n\n");
  }

  if (document.kind === "schema") out.write(standardJsonSchemaText("Type", "Schema"));

  return { text: out.toString(), mappings: out.mappings, problems: [] };
}

function resolveContainer(value: unknown, container: string): Record<string, unknown> {
  let current = value;
  for (const token of container.slice(1).split("/")) {
    current = isObject(current) ? current[token] : undefined;
  }
  return isObject(current) ? current : {};
}

/** The media type to read a body from: JSON if there is one, else the first. */
function pickMediaType(content: unknown): string | undefined {
  if (!isObject(content)) return undefined;
  const mediaTypes = Object.keys(content);
  return (
    mediaTypes.find((type) => type === "application/json") ??
    mediaTypes.find((type) => /[/+]json\b/.test(type)) ??
    mediaTypes[0]
  );
}

function bodyType(
  body: unknown,
  pointer: string,
  inferrer: TypeInferrer,
  indentLevel: number,
): TextBuilder | undefined {
  if (!isObject(body)) return undefined;
  const mediaType = pickMediaType(body.content);
  if (mediaType === undefined) return undefined;
  return inferrer.infer(`${pointer}/content/${escapePointerToken(mediaType)}/schema`, indentLevel);
}

const PARAMETER_LOCATIONS = [
  ["path", "PathParams"],
  ["query", "QueryParams"],
  ["header", "HeaderParams"],
  ["cookie", "CookieParams"],
] as const;

/** The types of an OpenAPI Operation Object: its parameters, request body and responses. */
function writeOperation(
  out: TextBuilder,
  operation: Record<string, unknown>,
  keys: KeySpans,
  inferrer: TypeInferrer,
): void {
  const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
  for (const [location, typeName] of PARAMETER_LOCATIONS) {
    const members = parameters
      .map((parameter, index) => ({ parameter, index }))
      .filter(({ parameter }) => isObject(parameter) && parameter.in === location);
    out.write(`export type ${typeName} = `);
    if (members.length === 0) {
      out.write("Record<string, never>;\n\n");
      continue;
    }
    out.write("{\n");
    for (const { parameter, index } of members) {
      const { name, required } = parameter as Record<string, unknown>;
      out.write("  ").writeMapped(formatKey(String(name)), keys.get(`/parameters/${index}/name`));
      out.write(required === true || location === "path" ? ": " : "?: ");
      out.append(inferrer.infer(`/parameters/${index}/schema`, 1)).write(";\n");
    }
    out.write("};\n\n");
  }

  const requestBody = bodyType(operation.requestBody, "/requestBody", inferrer, 0);
  out.write("export type RequestBody = ").append(requestBody ?? new TextBuilder().write("never")).write(";\n\n");

  const responses = isObject(operation.responses) ? operation.responses : {};
  const statuses = Object.keys(responses);
  out.write("export type Responses = {\n");
  for (const status of statuses) {
    const pointer = `/responses/${escapePointerToken(status)}`;
    const body = bodyType(responses[status], pointer, inferrer, 1);
    out.write("  ").writeMapped(JSON.stringify(status), keys.get(pointer)).write(": ");
    out.append(body ?? new TextBuilder().write("undefined")).write(";\n");
  }
  out.write("};\n\n");

  const success = statuses.find((status) => /^2/.test(status)) ?? statuses[0];
  out.write(
    success === undefined
      ? "export type Response<Status extends keyof Responses = never> = Responses[Status];\n\n"
      : `/** A response body, the first 2xx one unless a status is given. */\nexport type Response<Status extends keyof Responses = ${JSON.stringify(success)}> = Responses[Status];\n\n`,
  );
}


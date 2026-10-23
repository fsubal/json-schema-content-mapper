import { TextBuilder } from "./builder.js";
import type { Dialect } from "./dialect.js";
import { formatKey, scalarTypeText } from "./literal.js";
import { escapePointerToken, type KeySpans } from "./parse.js";

/** How loosely a fragment binds, so composing it can add the parentheses it needs. */
type Precedence = "atom" | "intersection" | "union";

interface Fragment {
  out: TextBuilder;
  precedence: Precedence;
}

export interface InferOptions {
  dialect: Dialect;
  /** Leave out the `[key: string]: unknown` that open objects (no `additionalProperties`) get. */
  strictObjects: boolean;
  /** Exported type names of local definitions, by JSON pointer (`/$defs/User`). */
  namedPointers: ReadonlyMap<string, string>;
  /** The type an external `$ref` stands for, e.g. `import("./user.schema.yaml").Type`. */
  externalRef(file: string, fragment: string): string | undefined;
}

const atom = (text: string): Fragment => ({ out: new TextBuilder().write(text), precedence: "atom" });
const UNKNOWN = "unknown";
const NEVER = "never";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wrap(fragment: Fragment, within: Precedence): TextBuilder {
  const needsParens =
    (within === "atom" && fragment.precedence !== "atom") ||
    (within === "intersection" && fragment.precedence === "union");
  return needsParens
    ? new TextBuilder().write("(").append(fragment.out).write(")")
    : fragment.out;
}

function join(fragments: Fragment[], separator: " | " | " & "): Fragment {
  const precedence: Precedence = separator === " | " ? "union" : "intersection";
  const out = new TextBuilder();
  fragments.forEach((fragment, index) => {
    if (index > 0) out.write(separator);
    out.append(wrap(fragment, precedence));
  });
  return { out, precedence };
}

export function union(fragments: Fragment[]): Fragment {
  const seen = new Set<string>();
  const members: Fragment[] = [];
  for (const fragment of fragments) {
    const text = fragment.out.toString();
    if (text === UNKNOWN) return atom(UNKNOWN);
    if (text === NEVER || seen.has(text)) continue;
    seen.add(text);
    members.push(fragment);
  }
  if (members.length === 0) return atom(NEVER);
  return members.length === 1 ? members[0]! : join(members, " | ");
}

function intersection(fragments: Fragment[]): Fragment {
  const members = fragments.filter((fragment) => fragment.out.toString() !== UNKNOWN);
  if (members.some((fragment) => fragment.out.toString() === NEVER)) return atom(NEVER);
  if (members.length === 0) return atom(UNKNOWN);
  return members.length === 1 ? members[0]! : join(members, " & ");
}

/** Escapes text for use inside a `/** ... *\/` comment. */
function commentText(text: string): string {
  return text.replaceAll("*/", "*\\/");
}

function docComment(schema: unknown, indent: string): string {
  if (!isObject(schema)) return "";
  const lines: string[] = [];
  if (typeof schema.description === "string") lines.push(...schema.description.split("\n"));
  else if (typeof schema.title === "string") lines.push(schema.title);
  if ("default" in schema) lines.push(`@default ${JSON.stringify(schema.default)}`);
  if (schema.deprecated === true) lines.push("@deprecated");
  if (lines.length === 0) return "";
  if (lines.length === 1) return `${indent}/** ${commentText(lines[0]!)} */\n`;
  return `${indent}/**\n${lines.map((line) => `${indent} * ${commentText(line)}`).join("\n")}\n${indent} */\n`;
}

export function decodePointer(fragment: string): string {
  return decodeURIComponent(fragment);
}

/** The value at a JSON pointer, or undefined. */
export function resolvePointer(root: unknown, pointer: string): unknown {
  if (pointer === "") return root;
  let current = root;
  for (const token of pointer.slice(1).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) current = current[Number(key)];
    else if (isObject(current) && Object.hasOwn(current, key)) current = current[key];
    else return undefined;
  }
  return current;
}

/** Dialects in which `$ref` makes its siblings ignored. */
const REF_OVERRIDES_SIBLINGS: ReadonlySet<Dialect> = new Set(["draft-04", "draft-06", "draft-07", "openapi-3.0"]);
const MODERN: ReadonlySet<Dialect> = new Set(["draft-2019-09", "draft-2020-12"]);

/**
 * Translates JSON Schema into TypeScript type text, following the data the
 * schema accepts: open objects get an `unknown` index signature, tuples are
 * as long as `minItems` demands, and `nullable` (OpenAPI 3.0) adds `| null`.
 */
export class TypeInferrer {
  private readonly resolving = new Set<string>();

  constructor(
    private readonly root: unknown,
    private readonly keys: KeySpans,
    private readonly options: InferOptions,
  ) {}

  /** The type of the schema at `pointer`, indented for `indentLevel`. */
  infer(pointer: string, indentLevel = 0): TextBuilder {
    return this.schemaType(resolvePointer(this.root, pointer), pointer, indentLevel).out;
  }

  private schemaType(schema: unknown, pointer: string, indentLevel: number): Fragment {
    if (schema === true || schema === undefined) return atom(UNKNOWN);
    if (schema === false) return atom(NEVER);
    if (!isObject(schema)) return atom(UNKNOWN);

    const parts: Fragment[] = [];
    if (typeof schema.$ref === "string") {
      const ref = this.refType(schema.$ref, indentLevel);
      if (REF_OVERRIDES_SIBLINGS.has(this.options.dialect)) return ref;
      parts.push(ref);
    }

    if ("const" in schema) {
      parts.push(this.literal(schema.const));
    } else if (Array.isArray(schema.enum)) {
      parts.push(union(schema.enum.map((value) => this.literal(value))));
    } else {
      const base = this.baseType(schema, pointer, indentLevel);
      if (base) parts.push(base);
    }

    if (Array.isArray(schema.allOf)) {
      schema.allOf.forEach((member, index) =>
        parts.push(this.schemaType(member, `${pointer}/allOf/${index}`, indentLevel)),
      );
    }
    for (const keyword of ["anyOf", "oneOf"] as const) {
      const members = schema[keyword];
      if (Array.isArray(members)) {
        parts.push(
          union(members.map((member, index) => this.schemaType(member, `${pointer}/${keyword}/${index}`, indentLevel))),
        );
      }
    }

    const type = intersection(parts);
    return this.options.dialect === "openapi-3.0" && schema.nullable === true
      ? union([type, atom("null")])
      : type;
  }

  private literal(value: unknown): Fragment {
    return atom(scalarTypeText(value) ?? JSON.stringify(value) ?? UNKNOWN);
  }

  /** The type from `type`, or from the keywords that imply one when it is absent. */
  private baseType(schema: Record<string, unknown>, pointer: string, indentLevel: number): Fragment | undefined {
    let types: unknown[];
    if (typeof schema.type === "string") {
      types = [schema.type];
    } else if (Array.isArray(schema.type)) {
      types = schema.type;
    } else if (["properties", "additionalProperties", "patternProperties", "required"].some((key) => key in schema)) {
      types = ["object"];
    } else if (["items", "prefixItems"].some((key) => key in schema)) {
      types = ["array"];
    } else {
      return undefined;
    }
    return union(
      types.map((type): Fragment => {
        switch (type) {
          case "null":
            return atom("null");
          case "boolean":
            return atom("boolean");
          case "integer":
          case "number":
            return atom("number");
          case "string":
            return atom("string");
          case "array":
            return this.arrayType(schema, pointer, indentLevel);
          case "object":
            return this.objectType(schema, pointer, indentLevel);
          default:
            return atom(UNKNOWN);
        }
      }),
    );
  }

  private arrayType(schema: Record<string, unknown>, pointer: string, indentLevel: number): Fragment {
    let prefix: unknown[] | undefined;
    let prefixKeyword: string;
    let rest: unknown;
    let restKeyword: string;
    if (Array.isArray(schema.prefixItems) && MODERN.has(this.options.dialect)) {
      [prefix, prefixKeyword, rest, restKeyword] = [schema.prefixItems, "prefixItems", schema.items, "items"];
    } else if (Array.isArray(schema.items)) {
      [prefix, prefixKeyword, rest, restKeyword] = [schema.items, "items", schema.additionalItems, "additionalItems"];
    } else {
      [prefixKeyword, rest, restKeyword] = ["", schema.items, "items"];
    }

    const restType = rest === false ? undefined : this.schemaType(rest, `${pointer}/${restKeyword}`, indentLevel);
    if (!prefix) {
      return { out: wrap(restType ?? atom(NEVER), "atom").write("[]"), precedence: "atom" };
    }
    const minItems = typeof schema.minItems === "number" ? schema.minItems : 0;
    const out = new TextBuilder().write("[");
    prefix.forEach((item, index) => {
      if (index > 0) out.write(", ");
      const element = this.schemaType(item, `${pointer}/${prefixKeyword}/${index}`, indentLevel);
      out.append(index < minItems ? element.out : wrap(element, "atom")).write(index < minItems ? "" : "?");
    });
    if (restType) {
      if (prefix.length > 0) out.write(", ");
      out.write("...").append(wrap(restType, "atom")).write("[]");
    }
    return { out: out.write("]"), precedence: "atom" };
  }

  private objectType(schema: Record<string, unknown>, pointer: string, indentLevel: number): Fragment {
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    const indent = "  ".repeat(indentLevel);
    const childIndent = "  ".repeat(indentLevel + 1);

    const members: { key: string; keySpanPointer?: string; schema: unknown; schemaPointer?: string; optional: boolean }[] = [];
    for (const [key, propertySchema] of Object.entries(properties)) {
      const propertyPointer = `${pointer}/properties/${escapePointerToken(key)}`;
      members.push({ key, keySpanPointer: propertyPointer, schema: propertySchema, schemaPointer: propertyPointer, optional: !required.has(key) });
    }
    for (const key of required) {
      if (!Object.hasOwn(properties, key)) members.push({ key, schema: true, optional: false });
    }

    const index = this.indexSignatureType(schema, pointer, indentLevel + 1);
    if (members.length === 0 && !index) return atom("{}");
    if (members.length === 0 && index?.out.toString() === UNKNOWN) {
      return atom("Record<string, unknown>");
    }

    const out = new TextBuilder().write("{\n");
    const memberTypes: Fragment[] = [];
    for (const member of members) {
      const type = this.schemaType(member.schema, member.schemaPointer ?? pointer, indentLevel + 1);
      memberTypes.push(type);
      out.write(docComment(member.schema, childIndent)).write(childIndent);
      out.writeMapped(formatKey(member.key), member.keySpanPointer ? this.keys.get(member.keySpanPointer) : undefined);
      out.write(member.optional ? "?: " : ": ").append(type.out).write(";\n");
    }
    if (index) {
      // Every property must fit the index signature, so it widens to them
      const indexType =
        index.out.toString() === UNKNOWN
          ? index
          : union([index, ...memberTypes, ...(members.some((member) => member.optional) ? [atom("undefined")] : [])]);
      out.write(`${childIndent}[key: string]: `).append(indexType.out).write(";\n");
    }
    return { out: out.write(`${indent}}`), precedence: "atom" };
  }

  /** The index signature's type, or undefined when the object is closed. */
  private indexSignatureType(schema: Record<string, unknown>, pointer: string, indentLevel: number): Fragment | undefined {
    const parts: Fragment[] = [];
    let additional = schema.additionalProperties;
    let additionalKeyword = "additionalProperties";
    if (additional === undefined && MODERN.has(this.options.dialect) && "unevaluatedProperties" in schema) {
      [additional, additionalKeyword] = [schema.unevaluatedProperties, "unevaluatedProperties"];
    }
    if (additional === undefined) {
      if (!this.options.strictObjects) parts.push(atom(UNKNOWN));
    } else if (additional !== false) {
      parts.push(this.schemaType(additional, `${pointer}/${additionalKeyword}`, indentLevel));
    }
    if (isObject(schema.patternProperties)) {
      for (const [pattern, patternSchema] of Object.entries(schema.patternProperties)) {
        parts.push(this.schemaType(patternSchema, `${pointer}/patternProperties/${escapePointerToken(pattern)}`, indentLevel));
      }
    }
    return parts.length === 0 ? undefined : union(parts);
  }

  private refType(ref: string, indentLevel: number): Fragment {
    const hashIndex = ref.indexOf("#");
    const file = hashIndex === -1 ? ref : ref.slice(0, hashIndex);
    const fragment = hashIndex === -1 ? "" : ref.slice(hashIndex + 1);
    if (file !== "") {
      const external = this.options.externalRef(file, decodePointer(fragment));
      return atom(external ?? `${UNKNOWN} /* unsupported $ref: ${commentText(ref)} */`);
    }
    if (fragment !== "" && !fragment.startsWith("/")) {
      return atom(`${UNKNOWN} /* unsupported $ref (anchor): ${commentText(ref)} */`);
    }
    const pointer = decodePointer(fragment);
    const name = this.options.namedPointers.get(pointer);
    if (name) return atom(name);

    const target = resolvePointer(this.root, pointer);
    if (target === undefined) return atom(`${UNKNOWN} /* unresolved $ref: ${commentText(ref)} */`);
    if (this.resolving.has(pointer)) return atom(`${UNKNOWN} /* recursive $ref: ${commentText(ref)} */`);
    this.resolving.add(pointer);
    try {
      return this.schemaType(target, pointer, indentLevel);
    } finally {
      this.resolving.delete(pointer);
    }
  }
}

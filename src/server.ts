// The content mapper process: TypeScript spawns `node dist/src/server.js` and
// speaks JSON-RPC 2.0 over stdio with LSP-style Content-Length framing.
import { OPENAPI_VERSIONS, SCHEMA_DIALECTS } from "./dialect.js";
import { mapSchemaFile, type ModuleOptions } from "./module.js";

export const DIAGNOSTIC_SOURCE = "json-schema";

/** Diagnostic codes, shown as `json-schema<code>`. */
export const CODES = { syntax: 1, option: 2, unsupportedFile: 3 } as const;

const DEFAULT_OPTIONS: ModuleOptions = {
  schemaDialect: "draft-2020-12",
  openapiVersion: "3.0",
  strictObjects: false,
};

const SUPPORTED_FILE_RE = /\.(?:ya?ml|jsonc)$/;

interface OptionDiagnostic {
  path: (string | number)[];
  messageText: string;
  code: number;
}

/** Reads a tsconfig entry's `options`, reporting what it cannot use. */
export function readOptions(raw: unknown): { options: ModuleOptions; diagnostics: OptionDiagnostic[] } {
  const options = { ...DEFAULT_OPTIONS };
  const diagnostics: OptionDiagnostic[] = [];
  const invalid = (key: string, expected: string) =>
    diagnostics.push({ path: [key], messageText: `"${key}" must be ${expected}.`, code: CODES.option });

  for (const [key, value] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    switch (key) {
      case "schemaDialect":
        if (SCHEMA_DIALECTS.includes(value as never)) options.schemaDialect = value as ModuleOptions["schemaDialect"];
        else invalid(key, `one of ${SCHEMA_DIALECTS.map((d) => `"${d}"`).join(", ")}`);
        break;
      case "openapiVersion":
        if (OPENAPI_VERSIONS.includes(value as never)) options.openapiVersion = value as ModuleOptions["openapiVersion"];
        else invalid(key, `one of ${OPENAPI_VERSIONS.map((v) => `"${v}"`).join(", ")}`);
        break;
      case "strictObjects":
        if (typeof value === "boolean") options.strictObjects = value;
        else invalid(key, "a boolean");
        break;
      default:
        diagnostics.push({
          path: [key],
          messageText: `Unknown option "${key}". Known options are schemaDialect, openapiVersion and strictObjects.`,
          code: CODES.option,
        });
    }
  }
  return { options, diagnostics };
}

type Params = Record<string, unknown>;

export function createHandlers(): Record<string, (params: Params) => unknown> {
  const projects = new Map<string, ModuleOptions>();
  return {
    initialize(params) {
      return {
        protocolVersion: params.protocolVersion ?? 1,
        positionEncoding: "utf-16",
        diagnosticSource: DIAGNOSTIC_SOURCE,
      };
    },
    openProject(params) {
      const { options, diagnostics } = readOptions(params.options);
      projects.set(String(params.projectHandle), options);
      return { optionDiagnostics: diagnostics };
    },
    transform(params) {
      const fileName = String(params.fileName);
      const content = String(params.content);
      if (!SUPPORTED_FILE_RE.test(fileName)) {
        return {
          extension: ".mts",
          text: "export type Schema = any;\nexport type Type = any;\n",
          diagnostics: [
            {
              messageText: `json-schema-content-mapper reads .yaml, .yml and .jsonc files; remove this extension from its contentMappers entry.`,
              start: 0,
              length: Math.min(content.length, 1),
              code: CODES.unsupportedFile,
            },
          ],
        };
      }
      const options = projects.get(String(params.projectHandle)) ?? DEFAULT_OPTIONS;
      const mapped = mapSchemaFile(fileName, content, options);
      return {
        // An ES module whatever the nearest package.json says: it only exports types
        extension: ".mts",
        text: mapped.text,
        mappings: mapped.mappings,
        diagnostics: mapped.problems.map((problem) => ({
          messageText: problem.message,
          start: problem.start,
          length: problem.length,
          code: CODES.syntax,
        })),
      };
    },
    closeProject(params) {
      projects.delete(String(params.projectHandle));
      return {};
    },
  };
}

interface Message {
  id?: number | string;
  method: string;
  params?: Params;
}

function send(message: unknown): void {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

export function serve(handlers = createHandlers()): void {
  let buffer = Buffer.alloc(0);
  const dispatch = (message: Message) => {
    let response;
    try {
      const handler = handlers[message.method];
      if (!handler) throw new Error(`Unknown method ${message.method}`);
      response = { jsonrpc: "2.0", id: message.id, result: handler(message.params ?? {}) ?? {} };
    } catch (error) {
      const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
      response = { jsonrpc: "2.0", id: message.id, error: { code: -32603, message: text } };
    }
    if (message.id !== undefined) send(response);
  };

  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const match = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString("ascii"));
      if (!match) throw new Error("Missing Content-Length header");
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + Number(match[1]);
      if (buffer.length < bodyEnd) return;
      const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.subarray(bodyEnd);
      dispatch(JSON.parse(body) as Message);
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

if (import.meta.main) serve();

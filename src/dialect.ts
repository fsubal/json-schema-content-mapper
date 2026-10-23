export type SchemaDialect = "draft-04" | "draft-06" | "draft-07" | "draft-2019-09" | "draft-2020-12";
export type OpenApiVersion = "3.0" | "3.1";

/** How schema keywords are read: which draft, and whether OpenAPI 3.0's `nullable` applies. */
export type Dialect = SchemaDialect | "openapi-3.0";

export type SchemaDocument =
  | { kind: "schema"; dialect: Dialect }
  | { kind: "openapi-document"; dialect: Dialect }
  | { kind: "openapi-operation"; dialect: Dialect };

export interface DialectDefaults {
  schemaDialect: SchemaDialect;
  openapiVersion: OpenApiVersion;
}

export const SCHEMA_DIALECTS: readonly SchemaDialect[] = [
  "draft-04",
  "draft-06",
  "draft-07",
  "draft-2019-09",
  "draft-2020-12",
];

export const OPENAPI_VERSIONS: readonly OpenApiVersion[] = ["3.0", "3.1"];

/** The dialect named by a `$schema` URI, if it is one this mapper knows. */
export function dialectOfSchemaUri(uri: string): SchemaDialect | undefined {
  if (/json-schema\.org\/draft\/2020-12\//.test(uri)) return "draft-2020-12";
  if (/json-schema\.org\/draft\/2019-09\//.test(uri)) return "draft-2019-09";
  if (/json-schema\.org\/draft-07\//.test(uri)) return "draft-07";
  if (/json-schema\.org\/draft-06\//.test(uri)) return "draft-06";
  if (/json-schema\.org\/draft-04\//.test(uri)) return "draft-04";
  return undefined;
}

/** OpenAPI 3.1 schemas are JSON Schema 2020-12; 3.0 schemas are their own draft-04 offshoot. */
export function dialectOfOpenApi(version: OpenApiVersion): Dialect {
  return version === "3.1" ? "draft-2020-12" : "openapi-3.0";
}

const OPERATION_KEYS = ["responses", "requestBody", "parameters"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Decides what a file is from its contents alone, since content mappers
 * never see import attributes:
 * - `openapi` at the top: a whole OpenAPI document
 * - `responses` / `requestBody` / `parameters`: an OpenAPI Operation Object
 *   (the per-action files of action_controller-open_api)
 * - otherwise a JSON Schema, of the draft its `$schema` names
 */
export function detectDocument(value: unknown, defaults: DialectDefaults): SchemaDocument {
  if (isObject(value)) {
    if (typeof value.openapi === "string") {
      const version: OpenApiVersion = value.openapi.startsWith("3.0") ? "3.0" : "3.1";
      return { kind: "openapi-document", dialect: dialectOfOpenApi(version) };
    }
    if (OPERATION_KEYS.some((key) => key in value)) {
      return { kind: "openapi-operation", dialect: dialectOfOpenApi(defaults.openapiVersion) };
    }
    if (typeof value.$schema === "string") {
      const dialect = dialectOfSchemaUri(value.$schema);
      if (dialect) {
        return { kind: "schema", dialect };
      }
    }
  }
  return { kind: "schema", dialect: defaults.schemaDialect };
}

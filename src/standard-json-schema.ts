/**
 * The Standard JSON Schema interfaces (https://standardschema.dev/json-schema),
 * copied into each virtual module as the spec recommends so that no package
 * has to be resolved from it. Structurally identical to `@standard-schema/spec`.
 */
const STANDARD_JSON_SCHEMA_V1 = `interface StandardTypedV1Props<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly types?: { readonly input: Input; readonly output: Output } | undefined;
}
interface StandardJSONSchemaV1Options {
  readonly target: "draft-2020-12" | "draft-07" | "openapi-3.0" | ({} & string);
  readonly libraryOptions?: Record<string, unknown> | undefined;
}`;

/**
 * The declaration of `StandardJSONSchema`: a Standard JSON Schema for
 * `typeName` whose converter hands back this very file's schema.
 *
 * There is no validate function, on purpose: pair it with whatever validator
 * the application already uses.
 */
export function standardJsonSchemaText(typeName: string, schemaTypeName: string): string {
  return `${STANDARD_JSON_SCHEMA_V1}
/** A Standard JSON Schema (StandardJSONSchemaV1) of this file, typed as {@link ${typeName}}. */
export interface StandardJSONSchema {
  readonly "~standard": StandardTypedV1Props<${typeName}, ${typeName}> & {
    readonly jsonSchema: {
      readonly input: (options: StandardJSONSchemaV1Options) => ${schemaTypeName};
      readonly output: (options: StandardJSONSchemaV1Options) => ${schemaTypeName};
    };
  };
}
`;
}

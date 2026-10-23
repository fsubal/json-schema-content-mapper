import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dialect } from "../src/dialect.js";
import { TypeInferrer } from "../src/infer.js";

function infer(schema: unknown, dialect: Dialect = "draft-2020-12", strictObjects = false): string {
  return new TypeInferrer(schema, new Map(), {
    dialect,
    strictObjects,
    namedPointers: new Map([["", "Type"]]),
    externalRef: (file, fragment) => `import(${JSON.stringify(file)}).${fragment === "" ? "Type" : "X"}`,
  })
    .infer("")
    .toString();
}

test("scalars, enums and const", () => {
  assert.equal(infer({ type: "integer" }), "number");
  assert.equal(infer({ type: ["string", "null"] }), "string | null");
  assert.equal(infer({ enum: ["a", 1, null] }), '"a" | 1 | null');
  assert.equal(infer({ const: "x" }), '"x"');
  assert.equal(infer(true), "unknown");
  assert.equal(infer(false), "never");
  assert.equal(infer({}), "unknown");
});

test("nullable applies only in OpenAPI 3.0", () => {
  assert.equal(infer({ type: "string", nullable: true }, "openapi-3.0"), "string | null");
  assert.equal(infer({ type: "string", nullable: true }), "string");
});

test("objects: required, open and closed", () => {
  assert.equal(
    infer({ type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false }),
    "{\n  a: string;\n}",
  );
  assert.equal(
    infer({ type: "object", properties: { a: { type: "string" } } }),
    "{\n  a?: string;\n  [key: string]: unknown;\n}",
  );
  assert.equal(infer({ type: "object", properties: { a: { type: "string" } } }, "draft-2020-12", true), "{\n  a?: string;\n}");
  assert.equal(infer({ type: "object" }), "Record<string, unknown>");
  assert.equal(infer({ type: "object", additionalProperties: false }), "{}");
});

test("index signatures widen to the declared properties", () => {
  assert.equal(
    infer({ type: "object", properties: { a: { type: "number" } }, additionalProperties: { type: "string" } }),
    "{\n  a?: number;\n  [key: string]: string | number | undefined;\n}",
  );
  assert.equal(infer({ type: "object", unevaluatedProperties: false, properties: {} }), "{}");
});

test("arrays and tuples", () => {
  assert.equal(infer({ type: "array", items: { type: ["string", "number"] } }), "(string | number)[]");
  assert.equal(infer({ type: "array" }), "unknown[]");
  assert.equal(
    infer({ type: "array", prefixItems: [{ type: "string" }, { type: "number" }], minItems: 1, items: false }),
    "[string, number?]",
  );
  assert.equal(infer({ prefixItems: [{ type: "string" }] }), "[string?, ...unknown[]]");
  assert.equal(
    infer({ type: "array", items: [{ type: "string" }], additionalItems: { type: "number" }, minItems: 1 }, "draft-07"),
    "[string, ...number[]]",
  );
});

test("composition", () => {
  assert.equal(infer({ anyOf: [{ type: "string" }, { type: "number" }] }), "string | number");
  assert.equal(
    infer({ allOf: [{ type: "object", properties: { a: { const: 1 } }, required: ["a"], additionalProperties: false }, { type: "object" }] }),
    "{\n  a: 1;\n} & Record<string, unknown>",
  );
  assert.equal(
    infer({ type: "object", oneOf: [{ required: ["a"] }, { required: ["b"] }] }, "draft-2020-12", true),
    "{} & ({\n  a: unknown;\n} | {\n  b: unknown;\n})",
  );
});

test("$ref: local, recursive, external and siblings", () => {
  const schema = { type: "array", items: { $ref: "#" } };
  assert.equal(infer(schema), "Type[]");
  assert.equal(infer({ $defs: { A: { type: "string" } }, $ref: "#/$defs/A" }), "string");
  assert.equal(infer({ $ref: "./user.schema.yaml" }), 'import("./user.schema.yaml").Type');
  assert.equal(infer({ $ref: "#/nowhere" }), "unknown /* unresolved $ref: #/nowhere */");
  // draft-07 ignores the siblings of $ref; 2020-12 applies them
  assert.equal(infer({ $defs: { A: { type: "string" } }, $ref: "#/$defs/A", const: "x" }, "draft-07"), "string");
  assert.equal(infer({ $defs: { A: { type: "string" } }, $ref: "#/$defs/A", const: "x" }), 'string & "x"');
});

test("doc comments carry description, default and deprecated", () => {
  assert.equal(
    infer({ type: "object", properties: { a: { type: "string", description: "A */ b", default: "x", deprecated: true } }, additionalProperties: false }),
    '{\n  /**\n   * A *\\/ b\n   * @default "x"\n   * @deprecated\n   */\n  a?: string;\n}',
  );
});

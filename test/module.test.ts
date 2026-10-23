import assert from "node:assert/strict";
import { test } from "node:test";
import { detectDocument } from "../src/dialect.js";
import { definitionTypeName, fileTypeName, mapSchemaFile } from "../src/module.js";
import { parseSchemaFile } from "../src/parse.js";

const OPTIONS = { schemaDialect: "draft-2020-12", openapiVersion: "3.0", strictObjects: false } as const;

test("documents are told apart by their contents", () => {
  assert.deepEqual(detectDocument({ openapi: "3.0.3" }, OPTIONS), { kind: "openapi-document", dialect: "openapi-3.0" });
  assert.deepEqual(detectDocument({ openapi: "3.1.0" }, OPTIONS), { kind: "openapi-document", dialect: "draft-2020-12" });
  assert.deepEqual(detectDocument({ responses: {} }, OPTIONS), { kind: "openapi-operation", dialect: "openapi-3.0" });
  assert.deepEqual(
    detectDocument({ $schema: "http://json-schema.org/draft-07/schema#" }, OPTIONS),
    { kind: "schema", dialect: "draft-07" },
  );
  assert.deepEqual(detectDocument({ type: "string" }, { ...OPTIONS, schemaDialect: "draft-04" }), { kind: "schema", dialect: "draft-04" });
});

test("names come from the file and the definitions", () => {
  assert.equal(fileTypeName("/a/_show.schema.yaml"), "Show");
  assert.equal(fileTypeName("/a/user-profile.schema.jsonc"), "UserProfile");
  assert.equal(fileTypeName("/a/2fa.yml"), "_2fa");
  assert.equal(definitionTypeName("type", new Set(["Type"])), "TypeDef");
});

test("YAML and JSONC record key spans by JSON pointer", () => {
  const yaml = parseSchemaFile("a.yaml", "a:\n  b: 1\n");
  assert.ok(yaml.ok);
  assert.deepEqual(yaml.keys.get("/a/b"), { start: 5, length: 1 });
  const jsonc = parseSchemaFile("a.jsonc", '\uFEFF{ /* c */ "a/b": [ { "c": 1 } ] }');
  assert.ok(jsonc.ok);
  assert.deepEqual(jsonc.keys.get("/a~1b/0/c"), { start: 22, length: 3 });
});

test("parse errors stay inside the file", () => {
  const result = parseSchemaFile("a.yaml", "a: [unclosed\n");
  assert.ok(!result.ok);
  for (const problem of result.problems) {
    assert.ok(problem.start + problem.length <= 13, JSON.stringify(problem));
  }
});

test("every mapping points from a generated key to the same key in the file", () => {
  const content = 'type: object\nproperties:\n  "user id":\n    type: integer\n  name:\n    type: string\n$defs:\n  Tag:\n    type: string\n';
  const mapped = mapSchemaFile("/a/x.schema.yaml", content, OPTIONS);
  assert.ok(mapped.mappings.length > 0);
  for (const [virtualStart, virtualLength, originalStart, originalLength] of mapped.mappings) {
    const generated = mapped.text.slice(virtualStart, virtualStart + virtualLength);
    const original = content.slice(originalStart, originalStart + originalLength);
    assert.equal(generated.replaceAll('"', ""), original.replaceAll('"', ""));
  }
});

test("a file that fails to parse is typed any, with the problem reported", () => {
  const mapped = mapSchemaFile("/a/x.schema.jsonc", "{ ", OPTIONS);
  assert.match(mapped.text, /export type Type = any;/);
  assert.equal(mapped.problems.length > 0, true);
});

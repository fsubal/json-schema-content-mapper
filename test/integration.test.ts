import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { before, test } from "node:test";
import { fixtures, linkMapperPackage, tsc } from "./fixtures.js";

before(linkMapperPackage);

function typecheck(project: string) {
  const result = spawnSync(process.execPath, [tsc, "-p", `${fixtures}/${project}`, "--runExternalCode", "--pretty", "false"], {
    encoding: "utf8",
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

test("the generated types satisfy every assertion in the basic fixture", () => {
  const { status, output } = typecheck("basic");
  assert.equal(output, "");
  assert.equal(status, 0);
});

test("action_controller-open_api operation files type with strictObjects from tsconfig options", () => {
  const { status, output } = typecheck("rails");
  assert.equal(output, "");
  assert.equal(status, 0);
});

test("the README's validator recipes typecheck and validate at run time", () => {
  const { status, output } = typecheck("recipes");
  assert.equal(output, "");
  assert.equal(status, 0);
  const run = spawnSync(process.execPath, ["run.ts"], { cwd: `${fixtures}/recipes`, encoding: "utf8" });
  assert.equal(run.stderr, "");
  assert.deepEqual(JSON.parse(run.stdout), {
    ajv: ["a", "rejected"],
    zodFromJsonSchema: [true, false],
    zodHandwritten: [true, false],
    standard: [true, true],
  });
});

test("parse errors are reported at their place in the schema file", () => {
  const { status, output } = typecheck("broken");
  assert.equal(status, 2);
  assert.match(output, /broken\.schema\.yaml\(3,15\): error json-schema1: Flow sequence/);
  // The failed module is `any`, so its importers add no errors of their own
  assert.doesNotMatch(output, /main\.ts/);
});

test("without --runExternalCode the mapper does not run", () => {
  const result = spawnSync(process.execPath, [tsc, "-p", `${fixtures}/basic`, "--pretty", "false"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readOptions } from "../src/server.js";

const server = fileURLToPath(new URL("../src/server.js", import.meta.url));

/** Sends requests to a real mapper process and collects one response per request. */
async function exchange(requests: { method: string; params: unknown }[]): Promise<any[]> {
  const child = spawn(process.execPath, [server]);
  let buffer = Buffer.alloc(0);
  const responses: any[] = [];
  const done = new Promise<void>((resolve) => {
    child.stdout.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, headerEnd).toString())![1]);
        if (buffer.length < headerEnd + 4 + length) return;
        responses.push(JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8")));
        buffer = buffer.subarray(headerEnd + 4 + length);
        if (responses.length === requests.length) resolve();
      }
    });
  });
  requests.forEach(({ method, params }, id) => {
    const payload = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    child.stdin.write(`Content-Length: ${payload.length}\r\n\r\n`);
    child.stdin.write(payload);
  });
  await done;
  child.stdin.end();
  return responses;
}

test("speaks the content mapper protocol", async () => {
  const [initialize, openProject, transform, closeProject] = await exchange([
    { method: "initialize", params: { positionEncodings: ["utf-8", "utf-16"], protocolVersion: 1 } },
    { method: "openProject", params: { projectHandle: "p", configFileName: "", options: { strictObjects: true } } },
    { method: "transform", params: { projectHandle: "p", fileName: "/a/x.schema.yaml", content: "type: object\nproperties:\n  a:\n    type: string\n" } },
    { method: "closeProject", params: { projectHandle: "p" } },
  ]);
  assert.deepEqual(initialize.result, { protocolVersion: 1, positionEncoding: "utf-16", diagnosticSource: "json-schema" });
  assert.deepEqual(openProject.result, { optionDiagnostics: [] });
  assert.equal(transform.result.extension, ".mts");
  // strictObjects from openProject leaves out the index signature
  assert.match(transform.result.text, /export type Type = \{\n {2}a\?: string;\n\};/);
  assert.deepEqual(closeProject.result, {});
});

test("reports options it cannot use", () => {
  const { diagnostics } = readOptions({ schemaDialect: "draft-03", strictObjects: "yes", other: 1 });
  assert.deepEqual(
    diagnostics.map(({ path }) => path),
    [["schemaDialect"], ["strictObjects"], ["other"]],
  );
});

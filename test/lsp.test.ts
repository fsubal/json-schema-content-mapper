import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { fixtures, linkMapperPackage, tsc } from "./fixtures.js";

// The editor's side: the same language server VS Code runs (`tsc --lsp --stdio`),
// with content mappers allowed as a trusted workspace allows them

const project = `${fixtures}/basic`;
const uri = (file: string) => pathToFileURL(`${project}/${file}`).href;

class LspClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, (message: any) => void>();

  constructor() {
    this.child = spawn(process.execPath, [tsc, "--lsp", "--stdio"], { cwd: project });
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const length = Number(/Content-Length: (\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString())![1]);
        if (this.buffer.length < headerEnd + 4 + length) return;
        const message = JSON.parse(this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8"));
        this.buffer = this.buffer.subarray(headerEnd + 4 + length);
        if (message.method && message.id !== undefined) {
          // Requests from the server: answer configuration with defaults, the rest with null
          const result = message.method === "workspace/configuration" ? message.params.items.map(() => ({})) : null;
          this.send({ jsonrpc: "2.0", id: message.id, result });
        } else if (message.id !== undefined) {
          this.pending.get(message.id)?.(message);
          this.pending.delete(message.id);
        }
      }
    });
  }

  private send(message: unknown): void {
    const payload = Buffer.from(JSON.stringify(message));
    this.child.stdin.write(`Content-Length: ${payload.length}\r\n\r\n`);
    this.child.stdin.write(payload);
  }

  async request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    const response = await new Promise<any>((resolve) => {
      this.pending.set(id, resolve);
      this.send({ jsonrpc: "2.0", id, method, params });
    });
    if (response.error) throw new Error(JSON.stringify(response.error));
    return response.result;
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  open(file: string, text: string): void {
    this.notify("textDocument/didOpen", { textDocument: { uri: uri(file), languageId: file.endsWith(".ts") ? "typescript" : "yaml", version: 1, text } });
  }

  change(file: string, version: number, text: string): void {
    this.notify("textDocument/didChange", { textDocument: { uri: uri(file), version }, contentChanges: [{ text }] });
  }

  async diagnostics(file: string): Promise<{ message: string; range: any; source?: string }[]> {
    return (await this.request("textDocument/diagnostic", { textDocument: { uri: uri(file) } })).items;
  }

  close(): void {
    this.child.kill();
  }
}

let client: LspClient;

before(async () => {
  linkMapperPackage();
  client = new LspClient();
  await client.request("initialize", {
    processId: process.pid,
    rootUri: pathToFileURL(project).href,
    workspaceFolders: [{ uri: pathToFileURL(project).href, name: "basic" }],
    capabilities: { textDocument: { hover: { contentFormat: ["markdown"] }, diagnostic: {} }, workspace: { configuration: true } },
    initializationOptions: { runExternalCode: true },
  });
  client.notify("initialized", {});
});

after(() => client.close());

const USAGE = [
  'import type { User, Address } from "./user.schema.yaml";',
  'export const user: User = { id: 1, name: "a", role: "admin" };',
  "export const role = user.role;",
  "export type A = Address;",
  "",
].join("\n");

test("hover shows the generated type with its doc comment", async () => {
  client.open("usage.ts", USAGE);
  const hover = await client.request("textDocument/hover", { textDocument: { uri: uri("usage.ts") }, position: { line: 3, character: 17 } });
  assert.match(hover.contents.value, /type Address = \{\n {4}city: string;\n {4}zip\?: string;\n\}/);
});

test("go to definition lands on the key in the YAML file", async () => {
  const yamlLines = readFileSync(`${project}/user.schema.yaml`, "utf8").split("\n");
  const property = await client.request("textDocument/definition", { textDocument: { uri: uri("usage.ts") }, position: { line: 2, character: 25 } });
  assert.equal(property[0].uri, uri("user.schema.yaml"));
  assert.equal(yamlLines[property[0].range.start.line], "  role:");
  const definition = await client.request("textDocument/definition", { textDocument: { uri: uri("usage.ts") }, position: { line: 3, character: 17 } });
  assert.equal(yamlLines[definition[0].range.start.line], "  Address:");
});

test("unsaved edits to the YAML file retype its importers, and YAML errors show in the YAML file", async () => {
  assert.deepEqual(await client.diagnostics("usage.ts"), []);
  const yaml = readFileSync(`${project}/user.schema.yaml`, "utf8");
  client.open("user.schema.yaml", yaml);
  const edited = yaml.replace("enum: [admin, member]", "enum: [owner, member]");
  client.change("user.schema.yaml", 2, edited);
  const [error] = await client.diagnostics("usage.ts");
  assert.match(error!.message, /Type '"admin"' is not assignable to type '"member" \| "owner"'/);

  client.change("user.schema.yaml", 3, `${edited}oops: [\n`);
  const [yamlError] = await client.diagnostics("user.schema.yaml");
  assert.equal(yamlError!.source, "json-schema");
  assert.match(yamlError!.message, /Flow sequence/);
});

import * as jsonc from "jsonc-parser";
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from "yaml";
import type { Node as YamlNode } from "yaml";

/** A UTF-16 range of the original file. */
export interface Span {
  start: number;
  length: number;
}

export interface Problem extends Span {
  message: string;
}

/** Key spans by JSON pointer (`""` for the root, `/properties/id` for a nested key). */
export type KeySpans = ReadonlyMap<string, Span>;

export type ParseResult =
  | { ok: true; value: unknown; keys: KeySpans }
  | { ok: false; problems: Problem[] };

const BOM = "﻿";

export function escapePointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function isYamlFile(fileName: string): boolean {
  return /\.ya?ml$/.test(fileName);
}

/** Parses a schema file as YAML or JSONC by its extension. */
export function parseSchemaFile(fileName: string, content: string): ParseResult {
  // A leading BOM keeps its offset so spans still line up with the file
  const offset = content.startsWith(BOM) ? 1 : 0;
  const text = content.slice(offset);
  const parsed = isYamlFile(fileName) ? parseYaml(text) : parseJsonc(text);
  const result = offset === 0 ? parsed : shift(parsed, offset);
  return result.ok ? result : { ok: false, problems: result.problems.map((problem) => clamp(problem, content.length)) };
}

/** Keeps a problem inside the file: TypeScript refuses spans past its end (an unclosed bracket's error sits there). */
function clamp(problem: Problem, contentLength: number): Problem {
  const start = Math.max(0, Math.min(problem.start, contentLength - 1));
  const length = Math.max(0, Math.min(problem.length, contentLength - start));
  return { ...problem, start, length };
}

function shift(result: ParseResult, offset: number): ParseResult {
  const move = <T extends Span>(span: T): T => ({ ...span, start: span.start + offset });
  if (!result.ok) {
    return { ok: false, problems: result.problems.map(move) };
  }
  const keys = new Map<string, Span>();
  for (const [pointer, span] of result.keys) {
    keys.set(pointer, move(span));
  }
  return { ok: true, value: result.value, keys };
}

function parseYaml(text: string): ParseResult {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, uniqueKeys: true });
  if (document.errors.length > 0) {
    return {
      ok: false,
      problems: document.errors.map((error) => ({
        message: error.message.split("\n")[0]!.replace(/ at line \d+, column \d+:?$/, ""),
        start: error.pos[0],
        length: Math.max(error.pos[1] - error.pos[0], 1),
      })),
    };
  }
  const keys = new Map<string, Span>();
  collectYamlKeys(document.contents, "", keys);
  return { ok: true, value: document.toJS({ maxAliasCount: -1 }), keys };
}

function collectYamlKeys(
  node: YamlNode | null,
  pointer: string,
  keys: Map<string, Span>,
): void {
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isScalar(pair.key)) {
        continue;
      }
      const child = `${pointer}/${escapePointerToken(String(pair.key.value))}`;
      const range = pair.key.range;
      if (range) {
        keys.set(child, { start: range[0], length: range[1] - range[0] });
      }
      collectYamlKeys(pair.value as YamlNode | null, child, keys);
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, index) =>
      collectYamlKeys(item as YamlNode | null, `${pointer}/${index}`, keys),
    );
  }
}

function parseJsonc(text: string): ParseResult {
  const errors: jsonc.ParseError[] = [];
  const root = jsonc.parseTree(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0 || !root) {
    const problems = errors.map((error) => ({
      message: jsonc.printParseErrorCode(error.error),
      start: error.offset,
      length: Math.max(error.length, 1),
    }));
    return {
      ok: false,
      problems: problems.length > 0 ? problems : [{ message: "Empty file", start: 0, length: 1 }],
    };
  }
  const keys = new Map<string, Span>();
  collectJsoncKeys(root, "", keys);
  return { ok: true, value: jsonc.getNodeValue(root), keys };
}

function collectJsoncKeys(node: jsonc.Node, pointer: string, keys: Map<string, Span>): void {
  if (node.type === "object") {
    for (const property of node.children ?? []) {
      const [keyNode, valueNode] = property.children ?? [];
      if (!keyNode) {
        continue;
      }
      const child = `${pointer}/${escapePointerToken(String(keyNode.value))}`;
      keys.set(child, { start: keyNode.offset, length: keyNode.length });
      if (valueNode) {
        collectJsoncKeys(valueNode, child, keys);
      }
    }
  } else if (node.type === "array") {
    (node.children ?? []).forEach((item, index) =>
      collectJsoncKeys(item, `${pointer}/${index}`, keys),
    );
  }
}

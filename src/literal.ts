import type { TextBuilder } from "./builder.js";
import { escapePointerToken, type KeySpans } from "./parse.js";

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function formatKey(key: string): string {
  return IDENTIFIER_RE.test(key) ? key : JSON.stringify(key);
}

function formatNumber(value: number): string {
  // JSON.parse never yields NaN/Infinity; -0 is not a valid literal type
  return Object.is(value, -0) ? "0" : String(value);
}

/** The literal type of a JSON scalar: `"a"`, `1`, `true`, `null`. */
export function scalarTypeText(value: unknown): string | undefined {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return formatNumber(value);
    case "boolean":
      return value ? "true" : "false";
  }
  return undefined;
}

/**
 * Writes the type `<value> as const` would infer (literal types, readonly
 * tuples, readonly properties), mapping each key back to the original file.
 */
export function writeLiteralType(
  out: TextBuilder,
  value: unknown,
  pointer: string,
  keys: KeySpans,
  indentLevel: number,
): void {
  const scalar = scalarTypeText(value);
  if (scalar !== undefined) {
    out.write(scalar);
    return;
  }
  const indent = "  ".repeat(indentLevel);
  const childIndent = "  ".repeat(indentLevel + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.write("readonly []");
      return;
    }
    out.write("readonly [\n");
    value.forEach((element, index) => {
      out.write(childIndent);
      writeLiteralType(out, element, `${pointer}/${index}`, keys, indentLevel + 1);
      out.write(",\n");
    });
    out.write(`${indent}]`);
    return;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    out.write("{}");
    return;
  }
  out.write("{\n");
  for (const [key, propertyValue] of entries) {
    const child = `${pointer}/${escapePointerToken(key)}`;
    out.write(`${childIndent}readonly `).writeMapped(formatKey(key), keys.get(child)).write(": ");
    writeLiteralType(out, propertyValue, child, keys, indentLevel + 1);
    out.write(";\n");
  }
  out.write(`${indent}}`);
}

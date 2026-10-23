import type { Span } from "./parse.js";

/** `[virtualStart, virtualLength, originalStart, originalLength, kind]` (typescript-go#4712). */
export type SpanMapping = [number, number, number, number, number];

/** Diagnostics on the span show the original text (the YAML/JSONC key), not the generated one. */
const SPAN_MAP_KIND_ALIAS = 2;

/**
 * Accumulates the virtual module's text, recording which generated spans
 * stand for which spans of the original file.
 */
export class TextBuilder {
  private text = "";
  readonly mappings: SpanMapping[] = [];

  write(chunk: string): this {
    this.text += chunk;
    return this;
  }

  /** Writes `chunk` and maps it back to `original` when there is one. */
  writeMapped(chunk: string, original: Span | undefined): this {
    if (original) {
      this.mappings.push([
        this.text.length,
        chunk.length,
        original.start,
        original.length,
        SPAN_MAP_KIND_ALIAS,
      ]);
    }
    return this.write(chunk);
  }

  /** Appends another builder's text, carrying its mappings over. */
  append(other: TextBuilder): this {
    for (const [virtualStart, ...rest] of other.mappings) {
      this.mappings.push([virtualStart + this.text.length, ...rest]);
    }
    return this.write(other.text);
  }

  toString(): string {
    return this.text;
  }
}

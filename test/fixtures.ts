import { mkdirSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../..", import.meta.url));
export const fixtures = `${root}test/fixtures`;
export const tsc = `${root}node_modules/typescript/bin/tsc`;

/**
 * Lets fixture projects find the mapper package as `json-schema-content-mapper`,
 * i.e. this repository. Test files run in parallel, so another one may have
 * made the link first.
 */
export function linkMapperPackage(): void {
  mkdirSync(`${fixtures}/node_modules`, { recursive: true });
  try {
    // Relative to test/fixtures/node_modules
    symlinkSync("../../..", `${fixtures}/node_modules/json-schema-content-mapper`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

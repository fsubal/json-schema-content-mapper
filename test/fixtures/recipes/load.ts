// Node: the value comes from the file at run time, the type from the content mapper
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { Schema } from "./user.schema.yaml";

export const userSchema = parse(readFileSync(new URL("./user.schema.yaml", import.meta.url), "utf8")) as Schema;

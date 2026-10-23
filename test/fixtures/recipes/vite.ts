// Vite: `?raw` is a different module specifier, so it is Vite's string, not the mapped module
import raw from "./user.schema.yaml?raw";
import { parse } from "yaml";
import type { Schema } from "./user.schema.yaml";

export const userSchema = parse(raw) as Schema;

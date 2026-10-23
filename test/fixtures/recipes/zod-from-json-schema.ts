import { z } from "zod";
import type { User } from "./user.schema.yaml";
import { userSchema } from "./load.ts";

// zod's JSONSchema type has mutable arrays, so the readonly Schema goes through unknown.
// z.fromJSONSchema() returns ZodType<unknown>; the mapper's type is what it validates to
export const UserZod = z.fromJSONSchema(userSchema as unknown as z.core.JSONSchema.JSONSchema) as z.ZodType<User>;

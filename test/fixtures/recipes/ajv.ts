import { Ajv2020 } from "ajv/dist/2020.js";
import type { User } from "./user.schema.yaml";
import { userSchema } from "./load.ts";

const ajv = new Ajv2020();
export const validateUser = ajv.compile<User>(userSchema);

export function parseUser(data: unknown): User {
  if (!validateUser(data)) throw new Error(ajv.errorsText(validateUser.errors));
  return data; // narrowed to User
}

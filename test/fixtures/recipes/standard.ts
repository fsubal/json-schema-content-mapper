// Bring your own validator: ajv as a Standard Schema that is also a Standard JSON Schema
import type { StandardJSONSchema, User } from "./user.schema.yaml";
import { validateUser } from "./ajv.ts";
import { userSchema } from "./load.ts";

type Issue = { readonly message: string; readonly path?: readonly PropertyKey[] };
type StandardUser = StandardJSONSchema & {
  readonly "~standard": {
    readonly validate: (value: unknown) => { readonly value: User; readonly issues?: undefined } | { readonly issues: readonly Issue[] };
  };
};

export const UserStandard: StandardUser = {
  "~standard": {
    version: 1,
    vendor: "my-app",
    jsonSchema: { input: () => userSchema, output: () => userSchema },
    validate(value) {
      if (validateUser(value)) return { value };
      return {
        issues: (validateUser.errors ?? []).map((error) => ({
          message: error.message ?? "invalid",
          path: error.instancePath.split("/").slice(1),
        })),
      };
    },
  },
};

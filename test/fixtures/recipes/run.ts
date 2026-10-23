// Run by the integration test with plain `node`: every value import works at run time
import { parseUser } from "./ajv.ts";
import { UserZod } from "./zod-from-json-schema.ts";
import { UserZod as HandwrittenUserZod } from "./zod-handwritten.ts";
import { UserStandard } from "./standard.ts";

const valid = { id: 1, name: "a", role: "admin", friends: [{ id: 2, name: "b", role: "member" }] };
const invalid = { id: 1, name: "a", role: "owner" };

const results = {
  ajv: [parseUser(valid).name, (() => { try { parseUser(invalid); return "accepted"; } catch { return "rejected"; } })()],
  zodFromJsonSchema: [UserZod.safeParse(valid).success, UserZod.safeParse(invalid).success],
  zodHandwritten: [HandwrittenUserZod.safeParse(valid).success, HandwrittenUserZod.safeParse(invalid).success],
  standard: [!("issues" in UserStandard["~standard"].validate(valid)), "issues" in UserStandard["~standard"].validate(invalid)],
};
console.log(JSON.stringify(results));

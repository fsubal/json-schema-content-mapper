import type { Schema as UserSchema, Type as UserType, User, Address, StandardJSONSchema } from "./user.schema.yaml";
import type * as Me from "./me.schema.yaml";
import type { Config } from "./config.schema.jsonc";
import type { Post } from "./post.schema.yaml";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function assert<T extends true>(): T | void {}

// Schema: the file itself, as const
assert<Equal<UserSchema["properties"]["role"]["enum"], readonly ["admin", "member"]>>();
assert<Equal<UserSchema["$defs"]["Address"]["required"], readonly ["city"]>>();

// Type: the data the schema accepts
assert<Equal<User, UserType>>();
assert<Equal<UserType["role"], "admin" | "member">>();
assert<Equal<UserType["email"], string | null | undefined>>();
assert<Equal<NonNullable<UserType["friends"]>[number], UserType>>();
assert<Equal<Address, { city: string; zip?: string }>>();
assert<Equal<NonNullable<UserType["address"]>, Address>>();

// OpenAPI Operation Object (OpenAPI 3.0: nullable)
assert<Equal<Me.Response["user"]["pixiv_id"], number | null | undefined>>();
assert<Equal<Me.Response["user"]["email_address"], string | null | undefined>>();
assert<Equal<Me.Response<"401">, { error: string }>>();
assert<Equal<Me.Responses["204"], undefined>>();
assert<Equal<Me.QueryParams, { include?: "profile" | "settings" }>>();
assert<Equal<Me.HeaderParams, { "X-Request-Id": string }>>();
assert<Equal<Me.RequestBody, never>>();

// draft-07 tuples, additionalProperties and const
assert<Equal<Config["point"], [number, number]>>();
assert<Equal<Config["labels"], { [key: string]: string } | undefined>>();
assert<Equal<Config["mode"], "fast" | undefined>>();

// $ref across files
assert<Equal<Post["author"], User>>();
assert<Equal<Post["shippedTo"], Address | undefined>>();

// Standard JSON Schema: types and the schema it converts to
assert<Equal<NonNullable<StandardJSONSchema["~standard"]["types"]>["output"], User>>();
assert<Equal<ReturnType<StandardJSONSchema["~standard"]["jsonSchema"]["input"]>, UserSchema>>();

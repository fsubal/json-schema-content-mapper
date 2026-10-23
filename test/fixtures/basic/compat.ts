// json-schema-to-ts reads the same Schema and agrees with the mapper's Type
import type { FromSchema } from "json-schema-to-ts";
import type { Schema as AddressHolder } from "./config.schema.jsonc";
import type * as Me from "./me.schema.yaml";
import type { Config } from "./config.schema.jsonc";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function assert<T extends true>(): T | void {}

type MeOk = Me.Schema["responses"]["401"]["content"]["application/problem+json"]["schema"];
assert<Equal<FromSchema<MeOk>, Me.Response<"401">>>();
assert<Equal<FromSchema<AddressHolder>, Config>>();

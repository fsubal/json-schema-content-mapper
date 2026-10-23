// The per-action schema files of action_controller-open_api (test/dummy), as YAML
import type * as Index from "./app/views/items/_index.schema.yaml";
import type * as Show from "./app/views/items/_show.schema.yaml";
import type * as Create from "./app/views/items/_create.schema.yaml";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function assert<T extends true>(): T | void {}

type Item = { id: number; name: string };

assert<Equal<Index.Response, Item[]>>();
assert<Equal<Show.Response, Item>>();
assert<Equal<Create.RequestBody, { name: string }>>();
assert<Equal<Create.Response, Item>>();
assert<Equal<Create.Response<"201">, Create.Response>>();

export async function createItem(body: Create.RequestBody): Promise<Create.Response> {
  const response = await fetch("/items", { method: "POST", body: JSON.stringify(body) });
  return (await response.json()) as Create.Response;
}

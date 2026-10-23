# json-schema-content-mapper

JSON Schema / OpenAPI のファイル（`.schema.yaml` / `.schema.yml` / `.schema.jsonc`）を、**コード生成なし・スキーマライブラリなし**で TypeScript の型として import できる [TypeScript 7.1 Content Mapper](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/) です。

```ts
import type { Schema, User, Address, StandardJSONSchema } from "./user.schema.yaml";
import type { FromSchema } from "json-schema-to-ts";

const user: User = { id: 1, name: "fsubal", role: "admin" }; // マッパーが推論した型
type SameUser = FromSchema<Schema>;                           // json-schema-to-ts とも併用できる
```

- Rails など他言語のサーバーが持つスキーマファイルが、そのまま TS の型になります（例: [action_controller-open_api](https://github.com/fsubal/action_controller-open_api) の per-action スキーマ）。
- `tsc` と エディタ（LSP）の両方で効きます。スキーマを編集すると、それに依存するコードに即座に型エラーが出ます。
- YAML / JSONC の構文エラーは、元ファイルの行と列で報告されます。
- zod / valibot / ajv などには依存しません。validate 関数も提供しません。手元の validator との組み合わせ方は[後述](#validator-との併用zod--ajv)。

## 必要なもの

- TypeScript 7.1 以上（現在は `typescript@beta`）
- Node.js 24 以上（マッパーのプロセスを動かすため）

## セットアップ

```sh
npm install -D typescript@beta json-schema-content-mapper
```

`tsconfig.json` のトップレベル（`compilerOptions` の隣）に `contentMappers` を足します。

```jsonc
{
  "compilerOptions": {
    "module": "nodenext",
    "verbatimModuleSyntax": true
  },
  "contentMappers": [
    {
      "package": "json-schema-content-mapper",
      "extensions": [".schema.yaml", ".schema.yml", ".schema.jsonc"],
      // 省略可
      "options": { "strictObjects": true }
    }
  ]
}
```

Content Mapper は任意のコードを実行するため、`tsc` では `--runExternalCode` が必要です。

```sh
tsc --noEmit --runExternalCode
```

エディタでは、TypeScript 7 の言語サーバー（`tsc --lsp --stdio`）が Content Mapper を使います。VS Code では、ワークスペースの TypeScript を使い、ワークスペースを信頼すると有効になります（`js/ts.contentMappers.enabled` で無効化できます）。言語サーバーに対して次のことを確認しています（`test/lsp.test.ts`）。

- ホバーに生成された型と JSDoc が出る
- go-to-definition が YAML / JSONC の該当キーに飛ぶ
- 保存前のスキーマの編集が、それを import するコードの診断に即座に反映される
- スキーマファイルの構文エラーが、スキーマファイル自身の診断として出る

### `.schema.json` は使えません

TypeScript は `.json` と、末尾が `.json` の拡張子（`.schema.json` など）を Content Mapper に登録させません（TS18066）。JSON で書くなら `.schema.jsonc` にしてください。中身はただの JSON のままで構いません。YAML で書くこともできます。

## import できるもの

マップされたモジュールは**型だけ**を export します。ランタイムでは何も読み込まないので `import type` で使います。値として import すると型エラーになるので、ランタイムで壊れることはありません。

### JSON Schema のファイル

| export | 内容 |
| --- | --- |
| `Schema` | スキーマそのもの。`as const` と同じリテラル型（readonly）。 |
| `Type` | スキーマが受け付けるデータの型。 |
| `<ファイル名の PascalCase>` | `Type` の別名。`user.schema.yaml` なら `User`、`_show.schema.yaml` なら `Show`。 |
| `$defs` / `definitions` の各エントリ | 名前を PascalCase にした型。`Schema` / `Type` などと衝突する場合は末尾に `Def` を付けます。 |
| `StandardJSONSchema` | [Standard JSON Schema](https://standardschema.dev/json-schema)（`StandardJSONSchemaV1`）の形の型。後述。 |

### OpenAPI Operation Object

`responses` / `requestBody` / `parameters` を持つファイルは、OpenAPI の Operation Object として読みます（action_controller-open_api の `_<action>.schema.*` と同じ形）。

| export | 内容 |
| --- | --- |
| `Schema` | ファイルそのもののリテラル型 |
| `PathParams` / `QueryParams` / `HeaderParams` / `CookieParams` | `parameters` から作るオブジェクト型 |
| `RequestBody` | リクエストボディの型。JSON のメディアタイプを優先します。ボディがなければ `never`。 |
| `Responses` | ステータスコードごとのレスポンスボディ。ボディのないレスポンスは `undefined`。 |
| `Response<Status>` | `Responses[Status]`。省略すると最初の 2xx。 |

### OpenAPI ドキュメント

トップレベルに `openapi` を持つファイルからは、`Schema` と `components.schemas` の各エントリを export します。

## 方言

マッパーには import attributes が渡らないので、方言はファイルの中身で決まります。

- `$schema` があれば、その draft（draft-04 / 06 / 07 / 2019-09 / 2020-12）として読みます。なければ `schemaDialect`（既定 `draft-2020-12`）。
- OpenAPI ドキュメントは `openapi` のバージョン、Operation Object は `openapiVersion`（既定 `"3.0"`）で読みます。3.0 では `nullable: true` を `| null` にし、3.1 は JSON Schema 2020-12 として扱います。
- draft-07 以前と OpenAPI 3.0 では、`$ref` と並ぶキーワードは無視されます（仕様どおり）。

## 型の作り方

- `type` / `enum` / `const` / `properties` / `required` / `additionalProperties` / `patternProperties` / `unevaluatedProperties` / `items` / `prefixItems` / `additionalItems` / `minItems`（タプルの必須長）/ `allOf` / `anyOf` / `oneOf` / `nullable`
- `additionalProperties` を書いていないオブジェクトは、JSON Schema の意味どおり `[key: string]: unknown` を持ちます（json-schema-to-ts と同じ）。サーバー側のスキーマにこれを書く習慣がなければ `strictObjects: true` にしてください。
- `description` / `default` / `deprecated` は JSDoc になり、ホバーで見えます。
- `$ref`
  - `#/...` は同じファイル内を参照します。`$defs` などに名前があればその型名になり、`#` は `Type` になります。再帰もそのまま表現できます。
  - `./user.schema.yaml`、`./user.schema.yaml#/$defs/Address` は `import("./user.schema.yaml").Type` / `.Address` になります。参照先も Content Mapper の対象拡張子である必要があります。
  - アンカー（`#foo`）や `$id` を使う参照、未知の参照先は `unknown` になり、理由が生成コードのコメントに残ります。
- `format` / `pattern` / `minimum` など、値の範囲だけを絞るキーワードは型に表れません。

## validator との併用（zod / ajv）

このパッケージは validate を提供しません。マップされたモジュールは型だけなので、validator と組み合わせるときは**値はランタイムで読み込み、型は `import type` で受け取る**形になります。以下のコードは `test/fixtures/recipes/` にそのまま置いてあり、型チェックと実行の両方をテストしています。

### スキーマの値を読み込む

`.schema.yaml` を import すると型だけのモジュールになるので、値はファイルから読みます。

```ts
// Node.js
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { Schema } from "./user.schema.yaml";

export const userSchema = parse(readFileSync(new URL("./user.schema.yaml", import.meta.url), "utf8")) as Schema;
```

```ts
// Vite: `?raw` は別の指定子なので、マップされたモジュールではなく Vite の文字列 import になる
import raw from "./user.schema.yaml?raw";
import { parse } from "yaml";
import type { Schema } from "./user.schema.yaml";

export const userSchema = parse(raw) as Schema;
```

`as Schema` が信頼できるのは、読み込んでいるファイルと型の元になっているファイルが同じだからです。

### ajv

`ajv.compile<User>()` に型を渡すと、`validate()` が `User` への型ガードになります。2020-12 のスキーマには `Ajv2020` を使います（既定の `Ajv` は draft-07）。

```ts
import { Ajv2020 } from "ajv/dist/2020.js";
import type { User } from "./user.schema.yaml";
import { userSchema } from "./load.ts";

const ajv = new Ajv2020();
export const validateUser = ajv.compile<User>(userSchema);

export function parseUser(data: unknown): User {
  if (!validateUser(data)) throw new Error(ajv.errorsText(validateUser.errors));
  return data; // User に絞り込まれる
}
```

### zod（`z.fromJSONSchema`）

zod 4 の `z.fromJSONSchema()` でスキーマから zod スキーマを作れます。戻り値は `ZodType<unknown>` なので、マッパーの型を付けます。

```ts
import { z } from "zod";
import type { User } from "./user.schema.yaml";
import { userSchema } from "./load.ts";

// zod の JSONSchema 型は配列が mutable なので、readonly な Schema は unknown を経由して渡す
export const UserZod = z.fromJSONSchema(userSchema as unknown as z.core.JSONSchema.JSONSchema) as z.ZodType<User>;
```

### zod（手書きのスキーマを、サーバー側のスキーマと突き合わせる）

ランタイムでファイルを読み込まない方法です。zod スキーマは手で書き、推論される型がサーバー側のスキーマと一致することを型レベルで検査します。Rails 側のスキーマが変わると、ここがコンパイルエラーになります（`Expected 1 arguments, but got 0.`）。

```ts
import { z } from "zod";
import type { User, Address } from "./user.schema.yaml";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function assertEqual<A, B>(..._: Equal<A, B> extends true ? [] : [never]): void {}

const AddressZod = z.object({ city: z.string(), zip: z.string().optional() });

export const UserZod = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string().nullable().optional(),
  role: z.enum(["admin", "member"]),
  tags: z.array(z.string()).optional(),
  address: AddressZod.optional(),
  get friends() {
    return z.array(UserZod).optional();
  },
});

assertEqual<z.infer<typeof AddressZod>, Address>();
assertEqual<z.infer<typeof UserZod>, User>();
```

`satisfies z.ZodType<User>` は片方向の検査なので、スキーマ側で増えたプロパティを見逃します。両方向で比べるには上のように `Equal` を使います。

### Standard Schema / Standard JSON Schema にする

`StandardJSONSchema` 型は [Standard JSON Schema](https://standardschema.dev/json-schema)（`StandardJSONSchemaV1`）の形をしています。`~standard.types` は `User`、`jsonSchema.input()` / `output()` の戻り値はこのファイルの `Schema` です。手元の validator と合わせれば、Standard Schema（`validate` を持つ）としても使えるオブジェクトを作れます。

```ts
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
```

`StandardJSONSchemaV1` のインターフェースは、仕様の推奨どおり生成モジュールの中に複製しています。構造的には `@standard-schema/spec` と同じなので、`@standard-schema/spec` を依存に足す必要はありません。

## オプション

| オプション | 既定値 | 内容 |
| --- | --- | --- |
| `schemaDialect` | `"draft-2020-12"` | `$schema` のないファイルの方言 |
| `openapiVersion` | `"3.0"` | Operation Object の OpenAPI バージョン（`"3.0"` / `"3.1"`） |
| `strictObjects` | `false` | `additionalProperties` のないオブジェクトに index signature を付けない |

## 開発

```sh
npm install
npm test   # build + unit / server プロトコル / tsc 統合テスト / 言語サーバー
```

`test/fixtures/*` は `tsc --runExternalCode` で型チェックする実プロジェクトです。`assertions.ts` などの型アサーションで生成型を検証しています。

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
- zod / valibot / ajv などには依存しません。validate 関数も提供しません（後述）。

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

VS Code では、ワークスペースの TypeScript を使い、ワークスペースを信頼すると有効になります（`js/ts.contentMappers.enabled` で無効化できます）。

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

## Standard JSON Schema とバリデーション

このパッケージは validate を提供しません。アプリケーションがすでに使っている validator（ajv や Standard JSON Schema 対応ライブラリなど）にスキーマを渡すときに、型を合わせるための `StandardJSONSchema` 型を用意しています。

```ts
import type { StandardJSONSchema } from "./user.schema.yaml";

// ~standard.types は User、jsonSchema.input() の戻り値はこのファイルの Schema
declare const userSchema: StandardJSONSchema;
```

`StandardJSONSchemaV1` のインターフェースは、仕様の推奨どおり生成モジュールの中に複製しています。構造的には `@standard-schema/spec` と同じなので、このパッケージを依存に足す必要はありません。

## オプション

| オプション | 既定値 | 内容 |
| --- | --- | --- |
| `schemaDialect` | `"draft-2020-12"` | `$schema` のないファイルの方言 |
| `openapiVersion` | `"3.0"` | Operation Object の OpenAPI バージョン（`"3.0"` / `"3.1"`） |
| `strictObjects` | `false` | `additionalProperties` のないオブジェクトに index signature を付けない |

## 開発

```sh
npm install
npm test   # build + unit / server プロトコル / tsc 統合テスト
```

`test/fixtures/*` は `tsc --runExternalCode` で型チェックする実プロジェクトです。`assertions.ts` などの型アサーションで生成型を検証しています。

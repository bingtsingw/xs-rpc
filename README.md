# xs-rpc

让前端开发可以享受后端API的类型，灵感来自于[ts-test](https://ts-rest.com)和[trpc](https://trpc.io)。  
设计上不绑定任何前后端框架，后端通过 `generator` 生成 `contract` 类型文件，前端请求库从 `contract` 中推导类型，理论上可以扩展支持任意后端框架和前端请求库。

| 包                    | 职责                                                             |
| --------------------- | ---------------------------------------------------------------- |
| `@xs-rpc/hono`        | 从 `Hono` 路由生成中间 `contrct`。                               |
| `@xs-rpc/client`      | 提供 `$get.call()`、`$post.callResponse()` 等 Proxy 请求客户端。 |
| `@xs-rpc/react-query` | 生成 `TanStack React Query` 的 options、缓存 key 与失效 filter。 |

## 安装

按需安装所需的包。`@xs-rpc/hono` 通常只用于代码生成脚本，`@xs-rpc/client` 用于运行时请求：

```sh
pnpm add @xs-rpc/client
pnpm add -D @xs-rpc/hono
```

若使用 React Query，还需要安装它的 peer dependencies：

```sh
pnpm add @xs-rpc/react-query @tanstack/react-query react
```

## @xs-rpc/hono

`@xs-rpc/hono` 不负责写文件或格式化。请在消费项目自己的脚本中完成这些工作：

```ts
import { writeFileSync } from 'node:fs';
import { analyzeHonoApi, renderApiManifest, renderApiSchema, renderTsRestCompat } from '@xs-rpc/hono';

const analysis = analyzeHonoApi({
  tsconfigPath: new URL('./tsconfig.json', import.meta.url).pathname,
  routeFilePath: new URL('./src/http/index.ts', import.meta.url).pathname,
  routerRules: [{ action: 'exclude', path: '/internal/**' }],
  resolveTypeImport: ({ sourceModuleSpecifier }) => {
    if (sourceModuleSpecifier === '@acme/validation') {
      return { moduleSpecifier: '@acme/validation', alias: 'Validation' };
    }
  },
});

writeFileSync('./src/generated/api-schema.ts', renderApiSchema(analysis));
writeFileSync('./src/generated/api-manifest.ts', renderApiManifest(analysis));
writeFileSync('./src/generated/api-contract.ts', renderTsRestCompat(analysis));
```

分析器会查找最近的 `package.json` 并使用其 `name`，以解析尚未处理的绝对或相对类型引用；命名空间别名则直接由该包名派生，例如 `@acme/constant` 会成为 `AcmeConstant`。若无法得到合法的 TypeScript 标识符，可通过 `resolveTypeImport` 显式指定别名。

支持识别中间件提供的 `__apiInputMetadata` 和 `__paginationKind`，可以通过这些字段来拓展功能。

## @xs-rpc/client

将底层请求库适配为 `getRequest().request()`。`input` 分为三个固定部分：`param` 用于替换路由参数、`query` 用于查询参数、`json` 用于请求体。

```ts
import { createXSRPCClient } from '@xs-rpc/client';
import type { ApiSchema } from './apiSchema';

const api = createXSRPCClient<ApiSchema>({
  getRequest: () => ({
    request: async ({ method, url, params, data, signal }) => {
      const response = await requestLibrary.request({ method, url, params, data, signal });
      return { status: response.status, data: response.data, headers: response.headers };
    },
  }),
});

await api.user[':id'].$get.call({ param: { id: 'user-1' } });
const response = await api.user[':id'].$get.callResponse({ param: { id: 'user-1' } });
```

`call()` 返回业务数据；`callResponse()` 返回包含 `status`、`headers`、`data` 等的 `response`。client 同时实现 `$request({ method, path, input, signal })` 通用协议，供 `@xs-rpc/react-query` 等适配包使用，通常无需直接调用它。

## @xs-rpc/react-query

`@xs-rpc/react-query` 是只面向 GET 的配套包，用于生成 TanStack React Query v5 的 options、缓存 key 与失效 filter。它不提供 `call()`、`callResponse()` 等请求能力；普通 client 已实现其注入所需的 `$request` 协议，但该包在运行时不依赖 `@xs-rpc/client`。

```ts
import { createXSRPCClient } from '@xs-rpc/client';
import { createXSRPCReactQuery } from '@xs-rpc/react-query';
import { useQuery } from '@tanstack/react-query';
import type { ApiSchema } from './generated/api-schema';

const $client = createXSRPCClient<ApiSchema>({ getRequest });
const $query = createXSRPCReactQuery<ApiSchema>({ client: $client });

const user = useQuery($query.user[':id'].$get.options.query({ param: { id: 'user-1' } }));
```

每个 GET endpoint 都提供下列分组：

```text
$get
├─ options
│  ├─ query(input?, queryOptions?)
│  ├─ infinite(input?, infiniteConfig)
│  └─ page(input?, pageOptions?)
├─ keys
│  ├─ query(input?)
│  ├─ infinite(input?)
│  └─ page(input?)
└─ filters
   ├─ query(input?)
   ├─ infinite(input?)
   ├─ page(input?)
   ├─ input(input?)
   └─ endpoint()
```

### 普通、无限与页码分页

`options.query()` 可直接传给 `useQuery`、`prefetchQuery` 或 `ensureQueryData`。  
`options.infinite()` 用于 `cursor`、`offset` 等自定义分页。

```ts
const feed = useInfiniteQuery(
  $query.feed.$get.options.infinite(
    { query: { tag: 'news' } },
    {
      initialPageParam: undefined as string | undefined,
      toInput: (cursor, input) => ({ ...input, query: { ...input.query, cursor } }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  ),
);
```

返回类型符合 `{ data: readonly unknown[] }` 的 endpoint 还会暴露 `options.page()`。它固定以 `?page=1` 开始，以空 `data` 停止；调用方传入的 `query.page` 会从稳定缓存身份中移除，并由 React Query 当前页参数替代。

### 缓存读取与失效

使用 `keys` 读取或写入某条确定的缓存，使用 `filters` 对一组缓存做失效处理。普通查询与无限查询刻意使用不同的缓存 key：

```ts
const input = { param: { id: 'user-1' } };

queryClient.setQueryData($query.user[':id'].$get.keys.query(input), userData);
queryClient.invalidateQueries($query.user[':id'].$get.filters.query(input));
```

| Filter                                            | 匹配范围                      |
| ------------------------------------------------- | ----------------------------- |
| `filters.query(input)`                            | normal query。                |
| `filters.infinite(input)` / `filters.page(input)` | infinite query。              |
| `filters.input(input)`                            | normal + infinite query。     |
| `filters.endpoint()`                              | 此endpoint，忽略query全部匹配 |

前三者中 `query`、`infinite` 与 `page` 使用精确匹配；`input` 与 `endpoint` 使用前缀匹配。不要在业务代码中手写这些 key 或 `{ exact: true }`。

# `@xs-rpc/react-query` 正式立项与实施计划

> 状态：首版已实现，待消费端验收与发布。目标是将 baotuan 已在真实业务、WebView 与小程序构建中验证过的**查询 options 能力**收敛为可独立发布的 `@xs-rpc/react-query`。本包不创建通用 RPC client、不暴露 `call` / `callResponse`，也不依赖 `@xs-rpc/client`；它只通过通用的 `XSRPCQueryClient<TSchema>` 的 `$request` 协议执行 GET 查询。

## 1. 背景与结论

baotuan 中的本地 `react-query-client` 已验证以下能力：普通查询、通用无限查询、约定式页码分页、精确/范围缓存失效、可选输入、请求取消信号转发，以及小程序生产构建。它同时暴露了 `call` / `callResponse`，但那是与独立 `@xs-rpc/client` 重叠的额外职责，**不是**本包的发布目标。

此前讨论曾出现“缓存形态优先”与“操作优先”两种 API 排列方式。最终采用**操作优先**，因为调用点通常已先确定自己在调用 `useQuery`、`useInfiniteQuery`、`invalidateQueries` 或 `setQueryData`：

```ts
const endpoint = $api.activity.pageForUser.$get;

useQuery(endpoint.options.query(input));
useInfiniteQuery(endpoint.options.page(input));

queryClient.invalidateQueries(endpoint.filters.page(input));
queryClient.setQueryData(endpoint.keys.query(input), data);
```

该包只生产 TanStack React Query 的 options、key 与 filter；不创建 `QueryClient`、不安装 Provider、不封装业务组件，也不提供可由业务直接调用的请求 API。

## 2. 立项目标

### 用户与问题

- 使用 `@xs-rpc/hono` 生成/维护 `ApiSchema` 的前端项目，希望保持 `$api.user[':id'].$get` 的端点导航与输入、输出类型推导；
- 不应让每个调用点手写 `queryKey`、`queryFn` 或 `{ exact: true }`，否则普通查询和无限查询容易共用错误缓存，失效范围也容易过宽；
- 小程序中取消查询必须真的向请求层传递 `AbortSignal`，不能为了规避兼容问题而静默丢弃取消能力；
- 已有 baotuan 的验证成果需要变成有测试、文档、版本边界与发布流程的公共库。

### v1 成功标准

1. 对每个 `$get` 端点生成类型安全的 `options`、`keys`、`filters`；非 GET 端点不出现在本包的公开调用面。
2. `query` 和 `infinite` 永不共享缓存键；`page` 复用 `infinite` 的缓存形态，不创建第三种数据形状。
3. `queryFn` 与 infinite `queryFn` 将 TanStack 提供的 `signal` 原样下传给请求执行器。
4. 空输入端点可省略 input；必填 input 不能被 Query 配置误当作 input；无效 input 在编译期失败。
5. 以 baotuan 的 WebView/小程序实际调用方式完成消费端 smoke test，并可独立发布到 npm。

### v1 非目标

- 不提供 `QueryClientProvider`、hydration、持久化缓存或组件层封装；
- 不在库内引入全局 polyfill 或隐式修改运行时；
- 不在首版提供 `$post.options.mutation()`。Mutation key、并发语义与失效策略尚未经过同等强度的业务验证；写请求继续由应用自己的请求层或独立 `@xs-rpc/client` 处理；
- 不根据路由字符串推断或自动失效相邻 endpoint；跨 endpoint 的失效必须由业务明确调用对应的 filter。

## 3. 公开 API 与语义

入口函数定为 `createXSRPCReactQuery<TSchema>({ client })`。`client` 只需实现通用 `$request` 协议；`@xs-rpc/client` 已实现该协议，因此常规接入不需要适配层：

```ts
const $client = createXSRPCClient<ApiSchema>({ getRequest });
const $query = createXSRPCReactQuery<ApiSchema>({ client: $client });
```

返回树仅为 schema 中的 `$get` 端点增加以下分组：

```text
$get
├─ options
│  ├─ query(input?, queryOptions?)
│  ├─ infinite(input?, infiniteConfig)  // 通用 cursor / offset / 自定义 pageParam
│  └─ page(input?, pageOptions?)        // 约定式 ?page=1, 2, 3
├─ keys
│  ├─ query(input?)
│  ├─ infinite(input?)
│  └─ page(input?)                      // infinite 的语义别名
└─ filters
   ├─ query(input?)                     // 精确普通查询
   ├─ infinite(input?)                  // 精确通用无限查询
   ├─ page(input?)                      // 精确页码无限查询
   ├─ input(input?)                     // 同 input 的两种查询形态
   └─ endpoint()                        // 此 endpoint 的全部 input 与查询形态
```

`options.query` 产出可直接传给 `useQuery`、`prefetchQuery`、`ensureQueryData` 的对象；`options.infinite` / `options.page` 产出可直接传给 `useInfiniteQuery` 的对象。用户需要 Suspense 时可将同一份 query options 传给 `useSuspenseQuery`，不增加专用 API。

`queryFn` 必须取得数据，但 React Query 包不自行创建请求，也不认识普通 client 的 `call` / `callResponse`。它只调用注入的 `client.$request({ method: 'GET', path, input, signal })`，并取得业务 data。URL 参数替换、204/205 归一、headers/status 与任意非 GET 请求均在 client 实现侧，不属于本包 API。

### 缓存身份与失效范围

缓存键按“从宽到窄”排序，`normalizedInput` 固化为 `{ param, query, json }`，缺省的 `param` / `query` 归一为 `{}`：

```ts
endpoint: ['api', 'GET', route];
input: ['api', 'GET', route, normalizedInput];
query: ['api', 'GET', route, normalizedInput, 'query'];
infinite: ['api', 'GET', route, normalizedInput, 'infinite'];
```

因此以下约束是 API 合约的一部分：

| API                                               | 匹配范围                               | `exact`      |
| ------------------------------------------------- | -------------------------------------- | ------------ |
| `filters.query(input)`                            | 该 input 的普通 query                  | `true`       |
| `filters.infinite(input)` / `filters.page(input)` | 该 input 的无限 query                  | `true`       |
| `filters.input(input)`                            | 该 input 的普通与无限 query            | 默认前缀匹配 |
| `filters.endpoint()`                              | 该 endpoint 的所有 input、所有查询形态 | 默认前缀匹配 |

业务代码不应自行拼接这类 key 或决定 `exact`。需要读取、预取或写入某一个已知缓存时使用 `keys.*`；需要操作一组缓存时使用 `filters.*`。

### 分页约定

- `options.infinite` 是底层 escape hatch：调用方提供 `initialPageParam`、`toInput(pageParam, input)` 与 `getNextPageParam`；
- `options.page` 仅在返回值符合 `{ data: readonly unknown[] }` 时暴露。它固定从 `page = 1` 开始，将动态页码只注入请求，不放入 key；空 `data` 表示没有下一页；
- `page` 的 input 是稳定筛选条件。实现会从对象型 `query` 中移除调用方误传的 `page`，再为每次请求注入 TanStack 的 `pageParam`；同一份“去掉 page 的 base input”用于 key。这样即使误传 `query.page`，也不会出现“请求被覆盖而 key 未归一”的歧义。

## 4. 架构与包边界

### 包结构与依赖

新增 `packages/react-query`，发布名为 `@xs-rpc/react-query`，初始版本 `0.1.0`。

- 运行时依赖：无；
- peer dependency：`@tanstack/react-query@^5` 与 React 18/19。包本身不调用 React API，但 TanStack React Query 要求 React peer，故显式声明以便消费端获得正确提示；
- 开发依赖：TanStack React Query v5、React、`@xs-rpc/client`（仅互操作测试）与现有 Bun/TypeScript 测试工具；
- 构建、ESM exports、`dist` 白名单、npm registry 与现有 `packages/client` 保持一致。

包内不保留 HTTP 请求实现：不做路径参数替换、`param/query/json` 映射、204/205 归一或 headers/status 处理。它只维护 schema 路由树、query key、filter 与 TanStack options，并将原始路由模板、schema input 和 signal 委托给 `client`。这样包不与 `@xs-rpc/client` 产生版本耦合，也不会把 React Query 的依赖强加给普通 RPC 调用方。

### 独立 client 协议

`@xs-rpc/react-query` 自己导出 schema 关联的通用 client 协议。例如，`GetPath<TSchema>` 只保留含 `GET` endpoint 的路径，`GetInput` / `GetOutput` 从该 endpoint 推导：

```ts
interface XSRPCQueryClient<TSchema> {
  $request<TPath extends GetPath<TSchema>>(request: {
    method: 'GET';
    path: TPath; // ApiSchema 中未替换的路由模板
    input: GetInput<TSchema, TPath>;
    signal?: AbortSignal;
  }): Promise<GetOutput<TSchema, TPath>>;
}
```

`queryFn({ signal })` 仅调用 `$request()` 并原样传入 signal；不得缓存或修改 signal。`@xs-rpc/client` 的 `XSRPCClient<TSchema>` 同时提供更宽的 `$request({ method, path, input, signal })` 协议，故其 GET overload 与上述接口结构兼容。React Query 包不导入或检查它的来源；任意同形 client 均可注入。

### 运行时兼容性

库不自动加载 polyfill。小程序应用必须在应用入口、创建 QueryClient 与任何查询运行前，加载已发布的 `@xstools/polyfill/mini-abort-controller`；旧 WebView 若缺少 `Object.hasOwn`，同样在入口加载 `@xstools/polyfill/object-has-own`。这两者属于宿主运行时责任，避免一个通用 npm 包意外污染 Web/Node 全局环境。

发布前须以真实小程序 client 验证：取消请求不会触发浏览器 `abortcontroller-polyfill` 所依赖的 DOM `initEvent` 路径，且 `signal` 到达底层请求器。

## 5. 测试与验收设计

测试以 baotuan 现有本地 adapter 的用例为迁移清单，而不是只做快照：

1. **GET queryFn 边界**：client 收到未替换的 schema path、原始 input 与同一 signal；原异常不包装；返回对象没有 `call` / `callResponse`，非 GET 端点也不生成 request facade。路径替换、请求映射和响应归一由普通 client 的 `$request` 单测覆盖。
2. **普通查询**：稳定的 normalized input key、用户 options 透传、不同 input 隔离、TanStack `signal` 原样下传。
3. **无限与页码分页**：普通与无限 key 不冲突；自定义 cursor/offset；页码从 1 递进、只将页码注入请求、空列表停止；`page` 的 key/filter 等价于 infinite。
4. **缓存范围**：逐一断言五个 filter 的 `queryKey` 与 `exact`，特别是 `input` 与 `endpoint` 的前缀边界。
5. **类型测试**：必填 `param/query/json` 不可省略；空 input 可省略且仍能传 Query 配置；输入与 options 不互相误判；`page` 只对列表输出可见；泛型 `select` / 自定义 error 仍推导正确。
6. **集成验收**：将 baotuan 的本地 `react-query-client` 临时替换为 workspace/tarball 中的 `@xs-rpc/react-query`，执行类型检查、WebView 构建和微信小程序生产构建，并手工验证参数切换/页面卸载时的取消。

## 6. 实施与发布计划

| 阶段 | 交付物 | 当前状态 | 完成条件 |
| --- | --- | --- | --- |
| 0. 冻结契约 | 本文 API、key、分页与非目标 | 已完成 | API 面与 `query.page` 归一规则均已确定，首版不含 mutation helpers |
| 1. 基础包 | `packages/react-query` manifest、入口、构建配置与 peer 声明 | 已完成 | 可打出只含 `dist` 的 ESM 包 |
| 2. 通用 client 协议 | `XSRPCQueryClient<TSchema>`、`queryFn → client.$request()` 与 signal 传递；普通 client 的 `$request` GET overload | 已完成 | 无 HTTP/request 实现、无 `call` / `callResponse` 公开出口，取消链路测试通过 |
| 3. Query core | typed proxy、normalization、`options.query`、`keys`、`filters` | 已完成 | 普通 query 与所有缓存范围测试通过 |
| 4. Infinite/Page | `options.infinite` 与条件化 `options.page` | 已完成 | pagination 与类型边界测试通过 |
| 5. 消费端验证 | baotuan workspace/tarball 替换、本地 adapter 删除或停用 | 待执行 | 以 `{ client: $client }` 接入，两端类型检查、构建、取消链路验收通过 |
| 6. 发布 | README、迁移示例、changeset、版本与 provenance | 待执行 | `build`、`check`、`test`、`check-publish` 通过并仅发布 `@xs-rpc/react-query@0.1.0` |

## 7. 发布后路线图（不阻塞 v1）

- 在真实 mutation 使用模式稳定后，评估是否增加独立的 `$post/$put/$patch/$delete.options.mutation()`；mutation input 不作为缓存身份，且该能力仍不应退化为通用 `call` client。
- 当 API schema 能标注 `page`、cursor、offset 等分页协议后，将 `page` 的可见性从“输出形状推断”升级为“契约驱动”。
- 评估后再增加 SSR/hydration 示例；它们应复用现有 options/key，不改变端点 API。

## 8. 参考基线

- Codex 讨论任务 `01a05340-e590-7070-92b7-aed9ad050b9d`：确定 `options / keys / filters` 命名、缓存层级、分页边界与小程序取消原则；
- baotuan 当前 `features/fe-api/src/react-query-client`：提取其查询、缓存、分页、取消与测试场景；明确不继承其中 `call` / `callResponse` 的公共面；
- [bearstory-mono PR #284](https://github.com/yxbl-club/bearstory-mono/pull/284)：TanStack Query v5 与业务调用面迁移的真实消费端参考，尤其用于验证精确失效和小程序/网页端构建。

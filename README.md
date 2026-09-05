# xs-rpc

`xs-rpc` turns a typed Hono route into portable client API types without coupling the generated client to Hono or a request library.

- `@xs-rpc/hono` owns route filtering, analyzes Hono's route type, and renders source strings.
- `@xs-rpc/client` provides the `$get.call()` / `$post.callResponse()` Proxy client.

## Generate API source

`@xs-rpc/hono` deliberately performs no output writes or formatting. Keep that policy in the consuming project's script:

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

The analyzer resolves unhandled absolute and relative type references by finding the closest `package.json` and using its `name`. Namespace aliases are derived directly from that name (`@acme/sd-constant` becomes `AcmeSdConstant`); if a valid TypeScript identifier cannot be derived, provide an alias with `resolveTypeImport`. It recognizes the `__apiInputMetadata` convention emitted by existing `defineApiInputRegistry` helpers, but does not own validation middleware.

## Create a client

```ts
import { createXSRPCClient } from '@xs-rpc/client';
import type { ApiSchema } from './generated/api-schema';

const api = createXSRPCClient<ApiSchema>({
  getRequest: () => ({
    request: async ({ method, url, params, data }) => {
      const response = await requestLibrary.request({ method, url, params, data });
      return { status: response.status, data: response.data, headers: response.headers };
    },
  }),
});

await api.user[':id'].$get.call({ param: { id: 'user-1' } });
```

The generated ts-rest compatibility output intentionally imports `@xstools/ts-rest-react-query/ts-rest-core`; projects using that target must install it directly.

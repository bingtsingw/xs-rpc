import { describe, expect, test } from 'bun:test';
import { createXSRPCClient } from '@xs-rpc/client';
import { createXSRPCReactQuery } from './client';
import type { XSRPCQueryClient } from './types';

interface TestApiSchema {
  '/health': { GET: { input: {}; output: { ok: true } } };
  '/users/:userId': {
    GET: {
      input: { param: { userId: string }; query: { includePosts?: boolean } };
      output: { id: string; name: string };
    };
    PATCH: { input: { json: { name: string } }; output: { id: string } };
  };
  '/feed': {
    GET: {
      input: { query: { cursor?: string; page?: number; tag: string } };
      output: { data: readonly { id: string }[] };
    };
  };
}

describe('createXSRPCReactQuery', () => {
  test('accepts any client that implements the exported $request protocol', async () => {
    const requests: unknown[] = [];
    const client: XSRPCQueryClient<TestApiSchema> = {
      $request: async (request) => {
        requests.push(request);
        return { ok: true } as never;
      },
    };
    const $query = createXSRPCReactQuery<TestApiSchema>({ client });
    const signal = new AbortController().signal;

    expect(await $query.health.$get.options.query().queryFn({ signal } as never)).toEqual({ ok: true });
    expect(requests).toEqual([{ input: {}, method: 'GET', path: '/health', signal }]);
  });

  test('accepts the standard xs-rpc client through its generic $request protocol', async () => {
    const requests: unknown[] = [];
    const client = createXSRPCClient<TestApiSchema>({
      getRequest: () => ({
        request: async (request) => {
          requests.push(request);
          return { status: 200, data: { id: 'u-1', name: 'Spring Bear' } };
        },
      }),
    });
    const $query = createXSRPCReactQuery<TestApiSchema>({ client });
    const signal = new AbortController().signal;

    const options = $query.users[':userId'].$get.options.query(
      { param: { userId: 'u/1' }, query: { includePosts: true } },
      { staleTime: 60_000 },
    );

    expect(options.queryKey).toEqual([
      'api',
      'GET',
      '/users/:userId',
      { json: undefined, param: { userId: 'u/1' }, query: { includePosts: true } },
      'query',
    ]);
    expect(options.staleTime).toBe(60_000);
    expect(await options.queryFn({ signal } as never)).toEqual({ id: 'u-1', name: 'Spring Bear' });
    expect(requests).toEqual([
      {
        method: 'get',
        url: '/users/u%2F1',
        params: { includePosts: true },
        data: undefined,
        signal,
      },
    ]);
  });

  test('keeps normal and infinite caches separate and provides scoped filters', () => {
    const client = createXSRPCClient<TestApiSchema>({
      getRequest: () => ({ request: async () => ({ status: 200, data: { data: [] } }) }),
    });
    const $query = createXSRPCReactQuery<TestApiSchema>({ client });
    const input = { query: { tag: 'news' } };

    expect($query.feed.$get.keys.query(input)).toEqual([
      'api',
      'GET',
      '/feed',
      { json: undefined, param: {}, query: { tag: 'news' } },
      'query',
    ]);
    expect($query.feed.$get.keys.infinite(input)).toEqual([
      'api',
      'GET',
      '/feed',
      { json: undefined, param: {}, query: { tag: 'news' } },
      'infinite',
    ]);
    expect($query.feed.$get.filters.query(input)).toEqual({
      exact: true,
      queryKey: $query.feed.$get.keys.query(input),
    });
    expect($query.feed.$get.filters.input(input)).toEqual({
      queryKey: ['api', 'GET', '/feed', { json: undefined, param: {}, query: { tag: 'news' } }],
    });
    expect($query.feed.$get.filters.endpoint()).toEqual({ queryKey: ['api', 'GET', '/feed'] });
  });

  test('uses custom page parameters for generic infinite queries without changing their stable key', async () => {
    const requests: unknown[] = [];
    const client = createXSRPCClient<TestApiSchema>({
      getRequest: () => ({
        request: async (request) => {
          requests.push(request);
          return { status: 200, data: { data: [] } };
        },
      }),
    });
    const $query = createXSRPCReactQuery<TestApiSchema>({ client });
    const signal = new AbortController().signal;
    const options = $query.feed.$get.options.infinite(
      { query: { tag: 'news' } },
      {
        getNextPageParam: () => 'next-cursor',
        initialPageParam: 'initial-cursor',
        toInput: (cursor, input) => ({ ...input, query: { ...input.query, cursor } }),
      },
    );

    expect(options.queryKey).toEqual($query.feed.$get.keys.infinite({ query: { tag: 'news' } }));
    await options.queryFn({ pageParam: 'next-cursor', signal } as never);
    expect(requests).toEqual([
      {
        method: 'get',
        url: '/feed',
        params: { cursor: 'next-cursor', tag: 'news' },
        data: undefined,
        signal,
      },
    ]);
  });

  test('page pagination strips a supplied page from its cache key and injects React Query page params', async () => {
    const requests: unknown[] = [];
    const client = createXSRPCClient<TestApiSchema>({
      getRequest: () => ({
        request: async (request) => {
          requests.push(request);
          return { status: 200, data: { data: [] } };
        },
      }),
    });
    const $query = createXSRPCReactQuery<TestApiSchema>({ client });
    const signal = new AbortController().signal;
    const options = $query.feed.$get.options.page({ query: { page: 99, tag: 'news' } });

    expect(options.queryKey).toEqual($query.feed.$get.keys.page({ query: { tag: 'news' } }));
    expect($query.feed.$get.filters.page({ query: { page: 99, tag: 'news' } })).toEqual({
      exact: true,
      queryKey: options.queryKey,
    });
    expect(options.getNextPageParam?.({ data: [{ id: '1' }] }, [{ data: [{ id: '1' }] }], 1, [1])).toBe(2);
    expect(options.getNextPageParam?.({ data: [] }, [{ data: [{ id: '1' }] }], 1, [1])).toBeUndefined();

    await options.queryFn({ pageParam: 1, signal } as never);
    await options.queryFn({ pageParam: 2, signal } as never);
    expect(requests).toEqual([
      { method: 'get', url: '/feed', params: { page: 1, tag: 'news' }, data: undefined, signal },
      { method: 'get', url: '/feed', params: { page: 2, tag: 'news' }, data: undefined, signal },
    ]);
  });

  test('supports empty inputs without mistaking query options for request inputs', () => {
    const client = createXSRPCClient<TestApiSchema>({
      getRequest: () => ({ request: async () => ({ status: 200, data: { ok: true } }) }),
    });
    const $query = createXSRPCReactQuery<TestApiSchema>({ client });

    expect($query.health.$get.options.query({ staleTime: 5 }).staleTime).toBe(5);
    expect(($query.users[':userId'].$get as unknown as { call?: unknown }).call).toBeUndefined();
  });
});

const typeClient = createXSRPCClient<TestApiSchema>({
  getRequest: () => ({ request: async () => ({ status: 200, data: { ok: true } }) }),
});
const typeQuery = createXSRPCReactQuery<TestApiSchema>({ client: typeClient });

const selected = typeQuery.users[':userId'].$get.options.query(
  { param: { userId: 'u-1' }, query: {} },
  { select: (user) => user.name },
);
const selectedName: string | undefined = selected.select?.({ id: 'u-1', name: 'Spring Bear' });
void selectedName;

const initialData = typeQuery.users[':userId'].$get.options.query(
  { param: { userId: 'u-1' }, query: {} },
  { initialData: { id: 'u-1', name: 'Initial Spring Bear' } },
);
void initialData;

// @ts-expect-error Required endpoint input cannot be omitted.
typeQuery.users[':userId'].$get.options.query();
// @ts-expect-error Only GET endpoints are exposed by the React Query package.
void typeQuery.users[':userId'].$post;
// @ts-expect-error Page helpers are available only for list-shaped outputs.
typeQuery.users[':userId'].$get.options.page({ param: { userId: 'u-1' }, query: {} });

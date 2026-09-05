import { describe, expect, test } from 'bun:test';

import { createXSRPCClient, type XSRPCClient } from './index';

interface TestApiSchema {
  '/creditScore/:creditScoreId/checkinInfo': {
    GET: {
      input: {
        param: { creditScoreId: string };
        query: { includeDeleted?: boolean; tags?: string[] };
      };
      output: { data: { checkInAt: string | null } };
    };
  };
  '/user/profile': { PATCH: { input: { json: { nickname: string } }; output: null } };
  '/health': { GET: { input: {}; output: { ok: true } } };
  '/metadata': {
    HEAD: { input: {}; output: null };
    OPTIONS: { input: {}; output: { allow: string[] } };
  };
  '/empty': { GET: { input: {}; output: null | undefined | '' } };
  '/noContent': { DELETE: { input: {}; output: null } };
}

describe('createXSRPCClient', () => {
  describe('proxy navigation and request dispatch', () => {
    test('defers executor resolution and maps param, query, and json', async () => {
      const requests: unknown[] = [];
      let getRequestCalls = 0;
      const api: XSRPCClient<TestApiSchema> = createXSRPCClient<TestApiSchema>({
        getRequest: () => {
          getRequestCalls += 1;

          return {
            request: async (request) => {
              requests.push(request);
              return { status: 200, data: { data: { checkInAt: '2026-08-25T08:00:00.000Z' } } };
            },
          };
        },
      });

      const checkin = api.creditScore[':creditScoreId'].checkinInfo.$get;
      expect(getRequestCalls).toBe(0);

      const response = await checkin.call({
        param: { creditScoreId: 'credit score/1' },
        query: { includeDeleted: true, tags: ['late', 'manual'] },
      });
      await api.user.profile.$patch.call({ json: { nickname: '春熊' } });

      expect(response).toEqual({ data: { checkInAt: '2026-08-25T08:00:00.000Z' } });
      expect(getRequestCalls).toBe(2);
      expect(requests).toEqual([
        {
          method: 'get',
          url: '/creditScore/credit%20score%2F1/checkinInfo',
          params: { includeDeleted: true, tags: ['late', 'manual'] },
          data: undefined,
        },
        { method: 'patch', url: '/user/profile', params: undefined, data: { nickname: '春熊' } },
      ]);
    });

    test('dispatches HEAD and OPTIONS endpoints', async () => {
      const methods: string[] = [];
      const api = createXSRPCClient<TestApiSchema>({
        getRequest: () => ({
          request: async ({ method }) => {
            methods.push(method);
            return { status: 200, data: null };
          },
        }),
      });

      await api.metadata.$head.call();
      await api.metadata.$options.call();

      expect(methods).toEqual(['head', 'options']);
    });
  });

  describe('response handling', () => {
    test('preserves non-204 empty values and normalizes 204/205 to null', async () => {
      for (const data of [null, undefined, ''] as const) {
        const api = createXSRPCClient<TestApiSchema>({
          getRequest: () => ({ request: async () => ({ status: 200, data }) }),
        });
        expect(api.empty.$get.call()).resolves.toBe(data);
      }

      for (const status of [204, 205]) {
        const api = createXSRPCClient<TestApiSchema>({
          getRequest: () => ({ request: async () => ({ status, data: '' }) }),
        });
        expect(api.noContent.$delete.call()).resolves.toBeNull();
      }
    });

    test('returns normalized metadata from callResponse', async () => {
      const api = createXSRPCClient<TestApiSchema>({
        getRequest: () => ({
          request: async () => ({
            status: 200,
            data: { ok: true },
            headers: {
              toJSON: () => ({
                ETag: '"config-v1"',
                'x-rate-limit': 12,
                'set-cookie': ['a=1', 'b=2'],
                ignored: null,
              }),
            },
          }),
        }),
      });

      expect(api.health.$get.callResponse()).resolves.toEqual({
        data: { ok: true },
        status: 200,
        headers: { etag: '"config-v1"', 'x-rate-limit': '12', 'set-cookie': ['a=1', 'b=2'] },
      });
    });

    test('preserves a no-content status and headers through callResponse', async () => {
      const api = createXSRPCClient<TestApiSchema>({
        getRequest: () => ({
          request: async () => ({ status: 204, data: '', headers: { ETag: '"config-v2"' } }),
        }),
      });

      expect(api.noContent.$delete.callResponse()).resolves.toEqual({
        data: null,
        status: 204,
        headers: { etag: '"config-v2"' },
      });
    });
  });

  describe('error propagation', () => {
    test('preserves request errors unchanged', async () => {
      const error = new Error('request failed');
      const api = createXSRPCClient<TestApiSchema>({
        getRequest: () => ({
          request: async () => {
            throw error;
          },
        }),
      });

      expect(api.health.$get.call()).rejects.toBe(error);
    });
  });
});

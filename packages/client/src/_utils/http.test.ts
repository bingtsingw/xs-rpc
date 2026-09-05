import { describe, expect, test } from 'bun:test';

import { isHttpMethod, toRequestPath, toResponseHeaders } from './http';

describe('HTTP utilities', () => {
  describe('method detection', () => {
    test('recognizes every supported client method key', () => {
      for (const method of ['$get', '$post', '$put', '$patch', '$delete', '$head', '$options']) {
        expect(isHttpMethod(method)).toBe(true);
      }
    });

    test('rejects invalid keys', () => {
      for (const key of ['$GET', '$trace', 'get', '$getExtra', 'then']) {
        expect(isHttpMethod(key)).toBe(false);
      }
    });
  });

  describe('path rendering', () => {
    test('leaves static paths unchanged and substitutes repeated parameters', () => {
      expect(toRequestPath('/health')).toBe('/health');
      expect(toRequestPath('/user/:id/post/:id', { id: 'user-1' })).toBe('/user/user-1/post/user-1');
    });

    test('serializes every supported path parameter scalar and URI-encodes it', () => {
      expect(
        toRequestPath('/user/:id/post/:postId/:published/:revision', {
          id: 'user /?%#中文',
          postId: 42,
          published: false,
          revision: 9_007_199_254_740_993n,
        }),
      ).toBe('/user/user%20%2F%3F%25%23%E4%B8%AD%E6%96%87/post/42/false/9007199254740993');
    });

    test('identifies the missing path parameter', () => {
      expect(() => toRequestPath('/user/:id')).toThrow('Missing path parameter: id');
      expect(() => toRequestPath('/user/:id/post/:postId', { id: 'user-1' })).toThrow('Missing path parameter: postId');
    });
  });

  describe('response headers', () => {
    test('normalizes plain-object header names and scalar values', () => {
      expect(toResponseHeaders({ ETag: '"config-v1"', 'X-Rate-Limit': 12, enabled: true, revision: 42n })).toEqual({
        etag: '"config-v1"',
        'x-rate-limit': '12',
        enabled: 'true',
        revision: '42',
      });
    });

    test('uses toJSON output in preference to the source object', () => {
      expect(
        toResponseHeaders({
          ignored: 'source value',
          toJSON: () => ({ ETag: '"config-v1"' }),
        }),
      ).toEqual({ etag: '"config-v1"' });
    });

    test('preserves header arrays and ignores nullish top-level header values', () => {
      expect(
        toResponseHeaders({
          'Set-Cookie': ['a=1', 2, false],
          empty: null,
          absent: undefined,
        }),
      ).toEqual({ 'set-cookie': ['a=1', '2', 'false'] });
    });
  });
});

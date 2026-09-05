import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

import { analyzeHonoApi, renderApiManifest, renderApiSchema, renderTsRestCompat } from '../src';

const tsconfigPath = fileURLToPath(new URL('./fixtures/tsconfig.json', import.meta.url));
const routeFilePath = fileURLToPath(new URL('./fixtures/app/src/route.ts', import.meta.url));
const invalidRouteFilePath = fileURLToPath(new URL('./fixtures/app/src/invalid-route.ts', import.meta.url));

const analyze = () => {
  return analyzeHonoApi({
    tsconfigPath,
    routeFilePath,
    routerRules: [
      { action: 'exclude', path: '/internal' },
      { action: 'exclude', path: '/metadata' },
      { action: 'exclude', path: '/not-present', reason: 'report unmatched rule' },
    ],
  });
};

describe('Hono API analysis and rendering', () => {
  describe('analysis', () => {
    test('extracts routes and reports filtering decisions without writing files', () => {
      const analysis = analyze();

      expect(analysis.summary).toEqual({
        total: 4,
        included: 2,
        excluded: 2,
        unmatchedRules: [analysis.routerRules[2]!],
      });
      expect(
        analysis.endpoints.map((endpoint) => [endpoint.method, endpoint.path, endpoint.decision.included]),
      ).toEqual([
        ['GET', '/health', true],
        ['POST', '/internal', false],
        ['HEAD', '/metadata', false],
        ['POST', '/users/:id', true],
      ]);
    });

    test('reports a missing route export with its source path', () => {
      expect(() => analyzeHonoApi({ tsconfigPath, routeFilePath, routeExportName: 'api' })).toThrow(
        'Unable to find route export "api"',
      );
    });
  });

  describe('ApiSchema rendering', () => {
    test('renders portable imports, registered inputs, and status aliases', () => {
      const schema = renderApiSchema(analyze());

      expect(schema).toContain('import type * as FixtureShared from "@fixture/shared";');
      expect(schema).toContain('export type ApiStatusCode = 200 | 201;');
      expect(schema).toContain('json: FixtureShared.NamedInput;');
      expect(schema).toContain('output: { data: FixtureShared.SharedDto; };');
      expect(schema).not.toContain('"/internal"');
      expect(schema).not.toContain('"/metadata"');
    });

    test('lets the resolver override both package specifier and alias', () => {
      const analysis = analyzeHonoApi({
        tsconfigPath,
        routeFilePath,
        routerRules: [
          { action: 'exclude', path: '/internal' },
          { action: 'exclude', path: '/metadata' },
        ],
        resolveTypeImport: ({ sourceModuleSpecifier }) =>
          sourceModuleSpecifier === '@fixture/shared' || sourceModuleSpecifier.includes('/shared/src/')
            ? { moduleSpecifier: '@example/contracts', alias: 'Contracts' }
            : undefined,
      });

      expect(renderApiSchema(analysis)).toContain('import type * as Contracts from "@example/contracts";');
    });

    describe('diagnostics', () => {
      test('rejects Hono type leaks with endpoint context', () => {
        const analysis = analyzeHonoApi({
          tsconfigPath,
          routeFilePath,
          routerRules: [
            { action: 'exclude', path: '/internal' },
            { action: 'exclude', path: '/metadata' },
          ],
          resolveTypeImport: () => ({ moduleSpecifier: 'hono' }),
        });

        expect(() => renderApiSchema(analysis)).toThrow('Failed to render POST /users/:id');
        expect(() => renderApiSchema(analysis)).toThrow('must not expose Hono types');
      });

      test('requires a discoverable package for exported types', async () => {
        const root = await mkdtemp(join(tmpdir(), 'xs-rpc-hono-'));
        const generatedTsconfigPath = join(root, 'tsconfig.json');
        const generatedRoutePath = join(root, 'route.ts');

        try {
          await Promise.all([
            writeFile(
              generatedTsconfigPath,
              JSON.stringify({
                compilerOptions: {
                  target: 'ESNext',
                  module: 'NodeNext',
                  moduleResolution: 'NodeNext',
                  strict: true,
                  skipLibCheck: true,
                  noEmit: true,
                },
                include: ['*.ts'],
              }),
            ),
            writeFile(join(root, 'shared.ts'), 'export interface SharedDto { id: string }\n'),
            writeFile(
              generatedRoutePath,
              "type HonoLike<TEnvironment, TSchema> = { environment: TEnvironment; schema?: TSchema };\ntype Schema = { '/data': { $get: { input: {}; output: import('./shared.js').SharedDto; outputFormat: 'json'; status: 200 } } };\nexport const route = {} as HonoLike<{}, Schema>;\n",
            ),
          ]);

          const analysis = analyzeHonoApi({ tsconfigPath: generatedTsconfigPath, routeFilePath: generatedRoutePath });
          expect(() => renderApiSchema(analysis)).toThrow('Unable to resolve a portable package name');
        } finally {
          await rm(root, { force: true, recursive: true });
        }
      });

      test('requires an explicit alias when a package name cannot form an identifier', () => {
        const analysis = analyzeHonoApi({
          tsconfigPath,
          routeFilePath,
          routerRules: [
            { action: 'exclude', path: '/internal' },
            { action: 'exclude', path: '/metadata' },
          ],
          resolveTypeImport: ({ sourceModuleSpecifier }) =>
            sourceModuleSpecifier === '@fixture/shared' || sourceModuleSpecifier.includes('/shared/src/')
              ? { moduleSpecifier: '123' }
              : undefined,
        });

        expect(() => renderApiSchema(analysis)).toThrow('Unable to derive a valid TypeScript namespace alias for 123');
      });

      test('rejects invalid custom aliases', () => {
        const analysis = analyzeHonoApi({
          tsconfigPath,
          routeFilePath,
          routerRules: [
            { action: 'exclude', path: '/internal' },
            { action: 'exclude', path: '/metadata' },
          ],
          resolveTypeImport: ({ sourceModuleSpecifier }) =>
            sourceModuleSpecifier === '@fixture/shared' || sourceModuleSpecifier.includes('/shared/src/')
              ? { moduleSpecifier: '@example/contracts', alias: '123' }
              : undefined,
        });

        expect(() => renderApiSchema(analysis)).toThrow(
          'Invalid TypeScript namespace alias "123" for @example/contracts',
        );
      });
    });
  });

  describe('ApiManifest rendering', () => {
    test('lists included endpoints and their request and response metadata', () => {
      const manifest = renderApiManifest(analyze());

      expect(manifest).toContain('key: "POST /users/:id"');
      expect(manifest).toContain('input: ["param","query","json"]');
      expect(manifest).not.toContain('"/internal"');
    });

    test('reports rendering failures with endpoint context', () => {
      const analysis = analyzeHonoApi({ tsconfigPath, routeFilePath: invalidRouteFilePath });

      expect(() => renderApiManifest(analysis)).toThrow('Failed to render GET /broken: Endpoint type is missing input');
    });
  });

  describe('ts-rest compatibility rendering', () => {
    test('renders the transitional contract for compatible endpoints', () => {
      const contract = renderTsRestCompat(analyze());

      expect(contract).toContain("import { initContract } from '@xstools/ts-rest-react-query/ts-rest-core';");
      expect(contract).toContain('responses: { 200: c.type<{ data: FixtureShared.SharedDto; }>() }');
      expect(contract).not.toContain('"internal"');
    });

    test('preserves legacy null, body, and response-status normalizations', () => {
      const analysis = analyzeHonoApi({
        tsconfigPath,
        routeFilePath,
        routerRules: [{ action: 'exclude', path: '/metadata' }],
      });
      const contract = renderTsRestCompat(analysis);

      expect(contract).toContain("path: 'internal'");
      expect(contract).toContain('body: c.type<undefined>()');
      expect(contract).toContain('responses: { 200: c.type<undefined>() }');
      expect(contract).not.toContain('responses: { 204:');
    });

    test('rejects unsupported HEAD endpoints with endpoint context', () => {
      const analysis = analyzeHonoApi({ tsconfigPath, routeFilePath });

      expect(() => renderTsRestCompat(analysis)).toThrow('ts-rest compatibility does not support HEAD');
    });
  });
});

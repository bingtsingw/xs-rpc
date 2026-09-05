import type { NamedInput } from '../../shared/src/index.js';

type RegisteredInput = NamedInput & {
  readonly __apiInputMetadata?: '@fixture/shared#NamedInput';
};

type StatusCode = 200 | 201;

type RouteSchema = {
  '/health': {
    $get: { input: {}; output: { ok: true }; outputFormat: 'json'; status: StatusCode };
  };
  '/internal': {
    $post: { input: {}; output: null; outputFormat: 'body'; status: 204 };
  };
  '/metadata': {
    $head: { input: {}; output: null; outputFormat: 'body'; status: 204 };
  };
  '/users/:id': {
    $post: {
      input: { param: { id: string }; query: { verbose?: boolean }; json: RegisteredInput };
      output: { data: import('../../shared/src/index.js').SharedDto };
      outputFormat: 'json';
      status: 200;
    };
  };
};

/** Mimics Hono's second type argument without introducing a runtime dependency in this unit fixture. */
type HonoLike<TEnvironment, TSchema> = { environment: TEnvironment; schema?: TSchema };

export const route = {} as HonoLike<{}, RouteSchema>;

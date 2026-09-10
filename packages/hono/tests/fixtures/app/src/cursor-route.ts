type CursorQuery = { category: string };

type RouteSchema = {
  '/feeds': {
    $get: {
      input: { query: CursorQuery; __paginationKind?: 'cursor' };
      output: { data: { id: string }[] };
      outputFormat: 'json';
      status: 200;
    };
  };
  '/cursor': {
    $get: {
      input: { __paginationKind?: 'cursor' };
      output: { data: { id: string }[] };
      outputFormat: 'json';
      status: 200;
    };
  };
  '/cursor/:id': {
    $get: {
      input: { param: { id: string }; __paginationKind?: 'cursor' };
      output: { data: { id: string }[] };
      outputFormat: 'json';
      status: 200;
    };
  };
};

type HonoLike<TEnvironment, TSchema> = { environment: TEnvironment; schema?: TSchema };

export const route = {} as HonoLike<{}, RouteSchema>;

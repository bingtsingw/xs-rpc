type PageQuery = { category: string };

type RouteSchema = {
  '/entries': {
    $get: {
      input: { query: PageQuery; __paginationKind?: 'page' };
      output: { data: { id: string }[] };
      outputFormat: 'json';
      status: 200;
    };
  };
  '/items': {
    $get: {
      input: { __paginationKind?: 'page' };
      output: { data: { id: string }[] };
      outputFormat: 'json';
      status: 200;
    };
  };
  '/items/:id': {
    $get: {
      input: { param: { id: string }; __paginationKind?: 'page' };
      output: { data: { id: string }[] };
      outputFormat: 'json';
      status: 200;
    };
  };
};

type HonoLike<TEnvironment, TSchema> = { environment: TEnvironment; schema?: TSchema };

export const route = {} as HonoLike<{}, RouteSchema>;

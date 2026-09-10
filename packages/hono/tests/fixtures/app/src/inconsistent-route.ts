type RouteSchema = {
  '/mixed': {
    $get:
      | {
          input: { __paginationKind?: 'page' };
          output: { data: { id: string }[] };
          outputFormat: 'json';
          status: 200;
        }
      | {
          input: { __paginationKind?: 'cursor' };
          output: { data: { id: string }[] };
          outputFormat: 'json';
          status: 200;
        };
  };
};

type HonoLike<TEnvironment, TSchema> = { environment: TEnvironment; schema?: TSchema };

export const route = {} as HonoLike<{}, RouteSchema>;

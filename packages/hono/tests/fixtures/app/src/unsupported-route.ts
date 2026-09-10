type RouteSchema = {
  '/offset': {
    $get: {
      input: { __paginationKind?: 'offset' };
      output: { data: { id: string }[] };
      outputFormat: 'json';
      status: 200;
    };
  };
};

type HonoLike<TEnvironment, TSchema> = { environment: TEnvironment; schema?: TSchema };

export const route = {} as HonoLike<{}, RouteSchema>;

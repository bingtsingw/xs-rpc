type InvalidRouteSchema = {
  '/broken': {
    $get: { output: { ok: true }; outputFormat: 'json'; status: 200 };
  };
};

type HonoLike<TEnvironment, TSchema> = { environment: TEnvironment; schema?: TSchema };

export const route = {} as HonoLike<{}, InvalidRouteSchema>;

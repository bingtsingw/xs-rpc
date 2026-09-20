import type {
  CreateXSRPCReactQueryOptions,
  XSRPCEndpointKey,
  XSRPCInputKey,
  XSRPCNormalizedRequestInput,
  XSRPCQueryKey,
  XSRPCReactQuery,
  XSRPCRequestInput,
} from './types';

const hasOwn = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);

const isRequestInput = (value: unknown): value is XSRPCRequestInput =>
  value !== null &&
  typeof value === 'object' &&
  (hasOwn(value, 'param') || hasOwn(value, 'query') || hasOwn(value, 'json'));

const toNormalizedRequestInput = (input: XSRPCRequestInput): XSRPCNormalizedRequestInput => ({
  json: hasOwn(input, 'json') ? input.json : undefined,
  param: input.param ?? {},
  query: input.query ?? {},
});

const toBasePageInput = (input: XSRPCRequestInput): XSRPCRequestInput => {
  if (input.query === null || typeof input.query !== 'object' || !hasOwn(input.query, 'page')) {
    return input;
  }

  const query = { ...(input.query as Record<string, unknown>) };
  delete query['page'];
  return { ...input, query };
};

const toPageInput = (page: number, input: XSRPCRequestInput): XSRPCRequestInput => ({
  ...input,
  query: {
    ...(input.query !== null && typeof input.query === 'object' ? input.query : {}),
    page,
  },
});

const createQueryMethod = <TSchema>(options: CreateXSRPCReactQueryOptions<TSchema>, path: string) => {
  const endpointKey = (): XSRPCEndpointKey => ['api', 'GET', path];
  const inputKey = (input: XSRPCRequestInput = {}): XSRPCInputKey => [
    ...endpointKey(),
    toNormalizedRequestInput(input),
  ];
  const queryKey = (input: XSRPCRequestInput = {}): XSRPCQueryKey<'query'> => [...inputKey(input), 'query'];
  const infiniteKey = (input: XSRPCRequestInput = {}): XSRPCQueryKey<'infinite'> => [...inputKey(input), 'infinite'];
  const execute = (input: XSRPCRequestInput, signal: AbortSignal) =>
    options.client.$request({ input: input as never, method: 'GET', path: path as never, signal });

  const query = (inputOrOptions?: XSRPCRequestInput | object, options?: object) => {
    const hasInput = options !== undefined || isRequestInput(inputOrOptions);
    const input = (hasInput ? (inputOrOptions ?? {}) : {}) as XSRPCRequestInput;
    const queryOptions = hasInput ? options : inputOrOptions;

    return {
      ...(queryOptions as object),
      queryFn: ({ signal }: { signal: AbortSignal }) => execute(input, signal),
      queryKey: queryKey(input),
    };
  };

  const infinite = (inputOrConfig: XSRPCRequestInput | object, config?: object) => {
    const hasInput = config !== undefined || isRequestInput(inputOrConfig);
    const input = (hasInput ? inputOrConfig : {}) as XSRPCRequestInput;
    const infiniteConfig = (hasInput ? config : inputOrConfig) as {
      initialPageParam: unknown;
      toInput: (pageParam: unknown, request: XSRPCRequestInput) => XSRPCRequestInput;
    };
    const { toInput, ...infiniteOptions } = infiniteConfig;

    return {
      ...infiniteOptions,
      queryFn: ({ pageParam, signal }: { pageParam: unknown; signal: AbortSignal }) =>
        execute(toInput(pageParam ?? infiniteOptions.initialPageParam, input), signal),
      queryKey: infiniteKey(input),
    };
  };

  const page = (inputOrOptions?: XSRPCRequestInput | object, options?: object) => {
    const hasInput = options !== undefined || isRequestInput(inputOrOptions);
    const input = toBasePageInput((hasInput ? (inputOrOptions ?? {}) : {}) as XSRPCRequestInput);
    const pageOptions = hasInput ? options : inputOrOptions;

    return infinite(input, {
      ...(pageOptions as object),
      getNextPageParam: (lastPage: { data: readonly unknown[] }, allPages: readonly { data: readonly unknown[] }[]) =>
        lastPage.data.length === 0 ? undefined : allPages.length + 1,
      initialPageParam: 1,
      toInput: toPageInput,
    });
  };

  return {
    filters: {
      endpoint: () => ({ queryKey: endpointKey() }),
      infinite: (input: XSRPCRequestInput = {}) => ({ exact: true, queryKey: infiniteKey(input) }),
      input: (input: XSRPCRequestInput = {}) => ({ queryKey: inputKey(input) }),
      page: (input: XSRPCRequestInput = {}) => ({ exact: true, queryKey: infiniteKey(toBasePageInput(input)) }),
      query: (input: XSRPCRequestInput = {}) => ({ exact: true, queryKey: queryKey(input) }),
    },
    keys: {
      infinite: infiniteKey,
      page: (input: XSRPCRequestInput = {}) => infiniteKey(toBasePageInput(input)),
      query: queryKey,
    },
    options: { infinite, page, query },
  };
};

const createQueryProxy = <TSchema>(options: CreateXSRPCReactQueryOptions<TSchema>, path: string[]): unknown =>
  new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'then' || typeof key !== 'string') {
          return undefined;
        }

        if (key === '$get') {
          return createQueryMethod(options, `/${path.join('/')}`);
        }

        if (key.startsWith('$')) {
          return undefined;
        }

        return createQueryProxy(options, [...path, key]);
      },
    },
  );

/** Creates a GET-only ApiSchema query-factory tree backed by an injected generic request client. */
export const createXSRPCReactQuery = <TSchema>(
  options: CreateXSRPCReactQueryOptions<TSchema>,
): XSRPCReactQuery<TSchema> => createQueryProxy(options, []) as XSRPCReactQuery<TSchema>;

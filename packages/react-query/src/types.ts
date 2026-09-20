import type { InfiniteData, QueryFilters, UseInfiniteQueryOptions, UseQueryOptions } from '@tanstack/react-query';

type QueryKind = 'query' | 'infinite';

type PathSegments<TPath extends string> = TPath extends `/${infer TRest}`
  ? PathSegments<TRest>
  : TPath extends `${infer TSegment}/${infer TRest}`
    ? [TSegment, ...PathSegments<TRest>]
    : TPath extends ''
      ? []
      : [TPath];

type UnionToIntersection<TValue> = (TValue extends unknown ? (value: TValue) => void : never) extends (
  value: infer TResult,
) => void
  ? TResult
  : never;

type Simplify<TValue> = { [TKey in keyof TValue]: TValue[TKey] } & {};
type InputOf<TEndpoint> = TEndpoint extends { input: infer TInput } ? TInput : never;
type OutputOf<TEndpoint> = TEndpoint extends { output: infer TOutput } ? TOutput : never;
type SchemaPath<TSchema> = Extract<keyof TSchema, string>;
type GetEndpoint<TSchema, TPath extends SchemaPath<TSchema>> = TSchema[TPath] extends { GET: infer TEndpoint }
  ? TEndpoint
  : never;

export type XSRPCGetPath<TSchema> = {
  [TPath in SchemaPath<TSchema>]: TSchema[TPath] extends { GET: unknown } ? TPath : never;
}[SchemaPath<TSchema>];

export type XSRPCGetInput<TSchema, TPath extends XSRPCGetPath<TSchema>> = InputOf<GetEndpoint<TSchema, TPath>>;

export type XSRPCGetOutput<TSchema, TPath extends XSRPCGetPath<TSchema>> = OutputOf<GetEndpoint<TSchema, TPath>>;

/** The only execution protocol required by this package. It is structurally compatible with an xs-rpc client. */
export interface XSRPCQueryClient<TSchema> {
  $request<TPath extends XSRPCGetPath<TSchema>>(request: {
    input: XSRPCGetInput<TSchema, TPath>;
    method: 'GET';
    path: TPath;
    signal?: AbortSignal;
  }): Promise<XSRPCGetOutput<TSchema, TPath>>;
}

export interface CreateXSRPCReactQueryOptions<TSchema> {
  client: XSRPCQueryClient<TSchema>;
}

export interface XSRPCRequestInput {
  json?: unknown;
  param?: Record<string, unknown>;
  query?: unknown;
}

export interface XSRPCNormalizedRequestInput {
  json: unknown;
  param: Record<string, unknown>;
  query: unknown;
}

export type XSRPCEndpointKey = readonly ['api', 'GET', string];
export type XSRPCInputKey = readonly [...XSRPCEndpointKey, Readonly<XSRPCNormalizedRequestInput>];
export type XSRPCQueryKey<TKind extends QueryKind> = readonly [...XSRPCInputKey, TKind];

export type XSRPCQueryOptions<TOutput, TData, TError> = Omit<
  UseQueryOptions<TOutput, TError, TData, XSRPCQueryKey<'query'>>,
  'queryFn' | 'queryKey'
>;

export type XSRPCInfiniteQueryConfig<TInput, TOutput, TPageParam, TError> = Omit<
  UseInfiniteQueryOptions<TOutput, TError, InfiniteData<TOutput, TPageParam>, XSRPCQueryKey<'infinite'>, TPageParam>,
  'initialPageParam' | 'queryFn' | 'queryKey'
> & {
  initialPageParam: TPageParam;
  toInput: (pageParam: TPageParam, input: TInput) => TInput;
};

type ApiQueryOptions<TOutput, TData, TError> = Omit<
  UseQueryOptions<TOutput, TError, TData, XSRPCQueryKey<'query'>>,
  'queryFn' | 'queryKey'
> & {
  queryFn: Exclude<NonNullable<UseQueryOptions<TOutput, TError, TData, XSRPCQueryKey<'query'>>['queryFn']>, symbol>;
  queryKey: XSRPCQueryKey<'query'>;
};

type ApiInfiniteQueryOptions<TOutput, TError, TPageParam> = Omit<
  UseInfiniteQueryOptions<TOutput, TError, InfiniteData<TOutput, TPageParam>, XSRPCQueryKey<'infinite'>, TPageParam>,
  'queryFn' | 'queryKey'
> & {
  queryFn: Exclude<
    NonNullable<
      UseInfiniteQueryOptions<
        TOutput,
        TError,
        InfiniteData<TOutput, TPageParam>,
        XSRPCQueryKey<'infinite'>,
        TPageParam
      >['queryFn']
    >,
    symbol
  >;
  queryKey: XSRPCQueryKey<'infinite'>;
};

type PageOutput = { data: readonly unknown[] };
type PageQueryOptions<TOutput, TError> = Omit<
  UseInfiniteQueryOptions<TOutput, TError, InfiniteData<TOutput, number>, XSRPCQueryKey<'infinite'>, number>,
  'getNextPageParam' | 'initialPageParam' | 'queryFn' | 'queryKey'
>;

type QueryOptionMethods<TEndpoint> = {
  query: {
    (input: InputOf<TEndpoint>): ApiQueryOptions<OutputOf<TEndpoint>, OutputOf<TEndpoint>, Error>;
    (
      input: InputOf<TEndpoint>,
      options: XSRPCQueryOptions<OutputOf<TEndpoint>, OutputOf<TEndpoint>, Error>,
    ): ApiQueryOptions<OutputOf<TEndpoint>, OutputOf<TEndpoint>, Error>;
    <TData = OutputOf<TEndpoint>, TError = Error>(
      input: InputOf<TEndpoint>,
      options: XSRPCQueryOptions<OutputOf<TEndpoint>, TData, TError>,
    ): ApiQueryOptions<OutputOf<TEndpoint>, TData, TError>;
  };
  infinite: <TPageParam, TError = Error>(
    input: InputOf<TEndpoint>,
    config: XSRPCInfiniteQueryConfig<InputOf<TEndpoint>, OutputOf<TEndpoint>, TPageParam, TError>,
  ) => ApiInfiniteQueryOptions<OutputOf<TEndpoint>, TError, TPageParam>;
} & ({} extends InputOf<TEndpoint>
  ? {
      query: {
        (): ApiQueryOptions<OutputOf<TEndpoint>, OutputOf<TEndpoint>, Error>;
        (
          options: XSRPCQueryOptions<OutputOf<TEndpoint>, OutputOf<TEndpoint>, Error>,
        ): ApiQueryOptions<OutputOf<TEndpoint>, OutputOf<TEndpoint>, Error>;
        <TData = OutputOf<TEndpoint>, TError = Error>(
          options: XSRPCQueryOptions<OutputOf<TEndpoint>, TData, TError>,
        ): ApiQueryOptions<OutputOf<TEndpoint>, TData, TError>;
      };
      infinite: <TPageParam, TError = Error>(
        config: XSRPCInfiniteQueryConfig<InputOf<TEndpoint>, OutputOf<TEndpoint>, TPageParam, TError>,
      ) => ApiInfiniteQueryOptions<OutputOf<TEndpoint>, TError, TPageParam>;
    }
  : unknown);

type PageQueryOptionMethods<TEndpoint> =
  OutputOf<TEndpoint> extends PageOutput
    ? {
        page: ((
          input: InputOf<TEndpoint>,
          options?: PageQueryOptions<OutputOf<TEndpoint>, Error>,
        ) => ApiInfiniteQueryOptions<OutputOf<TEndpoint>, Error, number>) &
          ({} extends InputOf<TEndpoint>
            ? (
                options?: PageQueryOptions<OutputOf<TEndpoint>, Error>,
              ) => ApiInfiniteQueryOptions<OutputOf<TEndpoint>, Error, number>
            : unknown);
      }
    : unknown;

type QueryKeyMethods<TEndpoint> = {
  query: (input: InputOf<TEndpoint>) => XSRPCQueryKey<'query'>;
  infinite: (input: InputOf<TEndpoint>) => XSRPCQueryKey<'infinite'>;
  page: (input: InputOf<TEndpoint>) => XSRPCQueryKey<'infinite'>;
} & ({} extends InputOf<TEndpoint>
  ? {
      query: (input?: InputOf<TEndpoint>) => XSRPCQueryKey<'query'>;
      infinite: (input?: InputOf<TEndpoint>) => XSRPCQueryKey<'infinite'>;
      page: (input?: InputOf<TEndpoint>) => XSRPCQueryKey<'infinite'>;
    }
  : unknown);

type QueryFilterMethods<TEndpoint> = {
  query: (input: InputOf<TEndpoint>) => QueryFilters;
  infinite: (input: InputOf<TEndpoint>) => QueryFilters;
  page: (input: InputOf<TEndpoint>) => QueryFilters;
  input: (input: InputOf<TEndpoint>) => QueryFilters;
  endpoint: () => QueryFilters;
} & ({} extends InputOf<TEndpoint>
  ? {
      query: (input?: InputOf<TEndpoint>) => QueryFilters;
      infinite: (input?: InputOf<TEndpoint>) => QueryFilters;
      page: (input?: InputOf<TEndpoint>) => QueryFilters;
      input: (input?: InputOf<TEndpoint>) => QueryFilters;
    }
  : unknown);

type QueryMethods<TEndpoint> = {
  filters: QueryFilterMethods<TEndpoint>;
  keys: QueryKeyMethods<TEndpoint>;
  options: QueryOptionMethods<TEndpoint> & PageQueryOptionMethods<TEndpoint>;
};

type QueryRoute<TSegments extends readonly string[], TEndpointMap> = TSegments extends [
  infer TSegment extends string,
  ...infer TRest extends string[],
]
  ? { [TKey in TSegment]: QueryRoute<TRest, TEndpointMap> }
  : TEndpointMap extends { GET: infer TEndpoint }
    ? { $get: QueryMethods<TEndpoint> }
    : {};

/** An ApiSchema route tree containing only GET query factories. */
export type XSRPCReactQuery<TSchema> = Simplify<
  UnionToIntersection<
    {
      [TPath in SchemaPath<TSchema>]: QueryRoute<PathSegments<TPath>, TSchema[TPath]>;
    }[SchemaPath<TSchema>]
  >
>;

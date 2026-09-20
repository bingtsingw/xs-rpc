import { isHttpMethod, toRequestPath, toResponseHeaders, type PathParameters } from './_utils/http';
import type { PathSegments, Simplify, UnionToIntersection } from './_utils/types';

export type XSRPCHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type XSRPCSchemaPath<TSchema> = Extract<keyof TSchema, string>;

type XSRPCMethodAt<TSchema, TPath extends XSRPCSchemaPath<TSchema>> = Extract<keyof TSchema[TPath], XSRPCHttpMethod>;

type XSRPCEndpointAt<TSchema, TPath extends XSRPCSchemaPath<TSchema>, TMethod extends XSRPCMethodAt<TSchema, TPath>> =
  TSchema[TPath] extends Record<TMethod, infer TEndpoint> ? TEndpoint : never;

type XSRPCInputOf<TEndpoint> = TEndpoint extends { input: infer TInput } ? TInput : never;
type XSRPCOutputOf<TEndpoint> = TEndpoint extends { output: infer TOutput } ? TOutput : never;

type XSRPCGetPath<TSchema> = {
  [TPath in XSRPCSchemaPath<TSchema>]: TSchema[TPath] extends { GET: unknown } ? TPath : never;
}[XSRPCSchemaPath<TSchema>];

type XSRPCGetEndpoint<TSchema, TPath extends XSRPCGetPath<TSchema>> = TSchema[TPath] extends {
  GET: infer TEndpoint;
}
  ? TEndpoint
  : never;

type ClientMethodCall<TEndpoint> = TEndpoint extends { input: infer TInput; output: infer TOutput }
  ? keyof TInput extends never
    ? {
        call: () => Promise<TOutput>;
        callResponse: () => Promise<XSRPCResponse<TOutput>>;
      }
    : {
        call: (input: TInput) => Promise<TOutput>;
        callResponse: (input: TInput) => Promise<XSRPCResponse<TOutput>>;
      }
  : never;

type ClientMethodCalls<TEndpointMap> = {
  [TMethod in Extract<keyof TEndpointMap, XSRPCHttpMethod> as `$${Lowercase<TMethod & string>}`]: ClientMethodCall<
    TEndpointMap[TMethod]
  >;
};

type ClientRoute<TSegments extends readonly string[], TEndpointMap> = TSegments extends [
  infer TSegment extends string,
  ...infer TRest extends string[],
]
  ? {
      [TKey in TSegment]: ClientRoute<TRest, TEndpointMap>;
    }
  : ClientMethodCalls<TEndpointMap>;

type XSRPCClientRoutes<TSchema> = Simplify<
  UnionToIntersection<
    {
      [TPath in Extract<keyof TSchema, string>]: ClientRoute<PathSegments<TPath>, TSchema[TPath]>;
    }[Extract<keyof TSchema, string>]
  >
>;

/** A schema-aware low-level request protocol for composing packages without endpoint-method coupling. */
export interface XSRPCRequestClient<TSchema> {
  $request<TPath extends XSRPCGetPath<TSchema>>(request: {
    input: XSRPCInputOf<XSRPCGetEndpoint<TSchema, TPath>>;
    method: 'GET';
    path: TPath;
    signal?: AbortSignal;
  }): Promise<XSRPCOutputOf<XSRPCGetEndpoint<TSchema, TPath>>>;

  $request<TPath extends XSRPCSchemaPath<TSchema>, TMethod extends XSRPCMethodAt<TSchema, TPath>>(request: {
    input: XSRPCInputOf<XSRPCEndpointAt<TSchema, TPath, TMethod>>;
    method: TMethod;
    path: TPath;
    signal?: AbortSignal;
  }): Promise<XSRPCOutputOf<XSRPCEndpointAt<TSchema, TPath, TMethod>>>;
}

export type XSRPCClient<TSchema> = XSRPCClientRoutes<TSchema> & XSRPCRequestClient<TSchema>;

export type XSRPCResponseHeaders = Readonly<Record<string, string | readonly string[]>>;

export interface XSRPCResponse<TData> {
  data: TData;
  headers: XSRPCResponseHeaders;
  status: number;
}

export interface XSRPCRequestConfig {
  data?: unknown;
  method: Lowercase<XSRPCHttpMethod>;
  params?: unknown;
  signal?: AbortSignal;
  url: string;
}

export interface XSRPCRequestResult {
  data: unknown;
  headers?: unknown;
  status: number;
}

export interface XSRPCRequestExecutor {
  request(config: XSRPCRequestConfig): Promise<XSRPCRequestResult>;
}

export interface CreateXSRPCClientOptions {
  /** Called for every API invocation so the executor can reflect current auth and configuration. */
  getRequest(): XSRPCRequestExecutor;
}

export interface XSRPCRequestInput {
  json?: unknown;
  param?: PathParameters;
  query?: unknown;
}

interface ClientMethod {
  call(input?: XSRPCRequestInput): Promise<unknown>;
  callResponse(input?: XSRPCRequestInput): Promise<XSRPCResponse<unknown>>;
}

interface ClientRequest {
  input: XSRPCRequestInput;
  method: XSRPCHttpMethod;
  path: string;
  signal?: AbortSignal;
}

const executeClientRequest = async (
  options: CreateXSRPCClientOptions,
  request: ClientRequest,
): Promise<XSRPCResponse<unknown>> => {
  const response = await options.getRequest().request({
    data: Object.hasOwn(request.input, 'json') ? request.input.json : undefined,
    method: request.method.toLowerCase() as Lowercase<XSRPCHttpMethod>,
    params: request.input.query,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    url: toRequestPath(request.path, request.input.param),
  });

  return {
    data: response.status === 204 || response.status === 205 ? null : response.data,
    headers: toResponseHeaders(response.headers),
    status: response.status,
  };
};

const createClientMethod = (
  options: CreateXSRPCClientOptions,
  path: string[],
  method: Lowercase<XSRPCHttpMethod>,
): ClientMethod => ({
  async call(input: XSRPCRequestInput = {}) {
    return (await this.callResponse(input)).data;
  },
  async callResponse(input: XSRPCRequestInput = {}) {
    return executeClientRequest(options, {
      input,
      method: method.toUpperCase() as XSRPCHttpMethod,
      path: `/${path.join('/')}`,
    });
  },
});

const createRequestMethod =
  (options: CreateXSRPCClientOptions) =>
  async (request: ClientRequest): Promise<unknown> =>
    (await executeClientRequest(options, request)).data;

const createClientProxy = (options: CreateXSRPCClientOptions, path: string[]): unknown =>
  new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'then') {
          return undefined;
        }

        if (typeof key !== 'string') {
          return undefined;
        }

        if (key === '$request') {
          return createRequestMethod(options);
        }

        if (isHttpMethod(key)) {
          return createClientMethod(options, path, key.slice(1).toLowerCase() as Lowercase<XSRPCHttpMethod>);
        }

        return createClientProxy(options, [...path, key]);
      },
    },
  );

export const createXSRPCClient = <TSchema>(options: CreateXSRPCClientOptions): XSRPCClient<TSchema> =>
  createClientProxy(options, []) as XSRPCClient<TSchema>;

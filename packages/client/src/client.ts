import { isHttpMethod, toRequestPath, toResponseHeaders, type PathParameters } from './_utils/http';
import type { PathSegments, Simplify, UnionToIntersection } from './_utils/types';

export type XSRPCHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

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

export type XSRPCClient<TSchema> = Simplify<
  UnionToIntersection<
    {
      [TPath in Extract<keyof TSchema, string>]: ClientRoute<PathSegments<TPath>, TSchema[TPath]>;
    }[Extract<keyof TSchema, string>]
  >
>;

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

interface ClientRequestInput {
  json?: unknown;
  param?: PathParameters;
  query?: unknown;
}

interface ClientMethod {
  call(input?: ClientRequestInput): Promise<unknown>;
  callResponse(input?: ClientRequestInput): Promise<XSRPCResponse<unknown>>;
}

const createClientMethod = (
  options: CreateXSRPCClientOptions,
  path: string[],
  method: Lowercase<XSRPCHttpMethod>,
): ClientMethod => ({
  async call(input: ClientRequestInput = {}) {
    return (await this.callResponse(input)).data;
  },
  async callResponse(input: ClientRequestInput = {}) {
    const response = await options.getRequest().request({
      data: Object.hasOwn(input, 'json') ? input.json : undefined,
      method,
      params: input.query,
      url: toRequestPath(`/${path.join('/')}`, input.param),
    });

    return {
      data: response.status === 204 || response.status === 205 ? null : response.data,
      headers: toResponseHeaders(response.headers),
      status: response.status,
    };
  },
});

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

        if (isHttpMethod(key)) {
          return createClientMethod(options, path, key.slice(1).toLowerCase() as Lowercase<XSRPCHttpMethod>);
        }

        return createClientProxy(options, [...path, key]);
      },
    },
  );

export const createXSRPCClient = <TSchema>(options: CreateXSRPCClientOptions): XSRPCClient<TSchema> =>
  createClientProxy(options, []) as XSRPCClient<TSchema>;

export type PathParameters = Record<string, string | number | boolean | bigint>;
type ResponseHeaders = Readonly<Record<string, string | readonly string[]>>;

const toHeaderString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  return Object.prototype.toString.call(value);
};

export const toResponseHeaders = (headers: unknown): ResponseHeaders => {
  const value =
    headers && typeof headers === 'object' && 'toJSON' in headers && typeof headers.toJSON === 'function'
      ? headers.toJSON()
      : headers;
  const entries = Object.entries(value ?? {});

  return Object.fromEntries(
    entries.flatMap(([name, header]) => {
      if (header === null || header === undefined) {
        return [];
      }

      const normalized = Array.isArray(header) ? header.map(toHeaderString) : toHeaderString(header);
      return [[name.toLowerCase(), normalized]];
    }),
  );
};

export const toRequestPath = (path: string, params?: PathParameters): string => {
  return path.replace(/:([A-Za-z0-9_]+)/gu, (_match, name: string) => {
    const value = params?.[name];

    if (value === undefined) {
      throw new Error(`Missing path parameter: ${name}`);
    }

    return encodeURIComponent(value.toString());
  });
};

export const isHttpMethod = (key: string): boolean => /^\$(get|post|put|patch|delete|head|options)$/u.test(key);

export type PathSegments<TPath extends string> = TPath extends `/${infer TRest}`
  ? PathSegments<TRest>
  : TPath extends `${infer TSegment}/${infer TRest}`
    ? [TSegment, ...PathSegments<TRest>]
    : TPath extends ''
      ? []
      : [TPath];

export type UnionToIntersection<TValue> = (TValue extends unknown ? (value: TValue) => void : never) extends (
  value: infer TResult,
) => void
  ? TResult
  : never;

export type Simplify<TValue> = { [TKey in keyof TValue]: TValue[TKey] } & {};

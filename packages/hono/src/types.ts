export const apiHttpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export type ApiHttpMethod = (typeof apiHttpMethods)[number];
export type ApiRouterRuleAction = 'include' | 'exclude';

/**
 * A restricted path glob used to decide whether a Hono route is emitted for clients.
 * `*` matches exactly one segment and `**` matches zero or more segments.
 */
export interface ApiRouterRule {
  action: ApiRouterRuleAction;
  path: string;
  methods?: readonly ApiHttpMethod[];
  reason?: string;
}

export interface ApiRoute {
  path: string;
  method: ApiHttpMethod;
}

export interface CompiledApiRouterRule extends ApiRouterRule {
  index: number;
  pathSegments: readonly string[];
}

export interface ApiRouterDecision {
  included: boolean;
  matchedRules: readonly CompiledApiRouterRule[];
}

export interface TypeImportResolution {
  /** A package specifier that is valid from the generated client's project. */
  moduleSpecifier: string;
  /** Optional namespace-import alias. A deterministic alias is derived when omitted. */
  alias?: string;
}

export interface ResolveTypeImportContext {
  /** The registered module specifier or absolute module path printed by TypeScript. */
  sourceModuleSpecifier: string;
  /** The route source file used as the base for a relative type-reference specifier. */
  sourceFilePath: string;
  kind: 'registered-api-input' | 'type-reference';
}

export type ResolveTypeImport = (context: ResolveTypeImportContext) => TypeImportResolution | undefined;

export interface AnalyzeHonoApiOptions {
  tsconfigPath: string;
  routeFilePath: string;
  routeExportName?: string;
  routerRules?: readonly ApiRouterRule[];
  resolveTypeImport?: ResolveTypeImport;
}

export interface AnalyzedHonoApiEndpoint {
  path: string;
  method: ApiHttpMethod;
  decision: ApiRouterDecision;
}

export interface HonoApiAnalysisSummary {
  total: number;
  included: number;
  excluded: number;
  unmatchedRules: readonly CompiledApiRouterRule[];
}

/** Opaque compiler-backed analysis. Pass this value to one of the render functions. */
export interface HonoApiAnalysis {
  endpoints: readonly AnalyzedHonoApiEndpoint[];
  routerRules: readonly CompiledApiRouterRule[];
  summary: HonoApiAnalysisSummary;
}

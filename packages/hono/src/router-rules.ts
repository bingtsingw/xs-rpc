import type { ApiRoute, ApiRouterDecision, ApiRouterRule, CompiledApiRouterRule } from './types';

const normalizePath = (path: string): string => {
  if (!path.startsWith('/')) {
    throw new Error(`Route patterns must start with /: ${path}`);
  }

  const normalized = path.replaceAll('\\', '/').replace(/\/{2,}/gu, '/');
  return normalized.length > 1 ? normalized.replace(/\/+$/gu, '') : normalized;
};

const getPathSegments = (path: string): readonly string[] => normalizePath(path).split('/').filter(Boolean);

const validatePathSegment = (segment: string, rule: ApiRouterRule): void => {
  if (segment.includes('*') && segment !== '*' && segment !== '**') {
    throw new Error(`Unsupported route matching syntax: ${rule.path}. Only full * and ** segments are supported.`);
  }
};

const matchesPathSegments = (patternSegments: readonly string[], pathSegments: readonly string[]): boolean => {
  const matchesFrom = (patternIndex: number, pathIndex: number): boolean => {
    if (patternIndex === patternSegments.length) {
      return pathIndex === pathSegments.length;
    }

    const patternSegment = patternSegments[patternIndex];

    if (patternSegment === '**') {
      if (patternIndex === patternSegments.length - 1) {
        return true;
      }

      for (let nextPathIndex = pathIndex; nextPathIndex <= pathSegments.length; nextPathIndex += 1) {
        if (matchesFrom(patternIndex + 1, nextPathIndex)) {
          return true;
        }
      }

      return false;
    }

    if (!pathSegments[pathIndex]) {
      return false;
    }

    return (
      (patternSegment === '*' || patternSegment === pathSegments[pathIndex]) &&
      matchesFrom(patternIndex + 1, pathIndex + 1)
    );
  };

  return matchesFrom(0, 0);
};

export const compileApiRouterRules = (routerRules: readonly ApiRouterRule[] = []): readonly CompiledApiRouterRule[] => {
  return routerRules.map((rule, index) => {
    const pathSegments = getPathSegments(rule.path);

    for (const segment of pathSegments) {
      validatePathSegment(segment, rule);
    }

    return { ...rule, index, pathSegments };
  });
};

export const doesApiRouterRuleMatch = (rule: CompiledApiRouterRule, route: ApiRoute): boolean => {
  const matchesMethod = !rule.methods || rule.methods.includes(route.method);
  return matchesMethod && matchesPathSegments(rule.pathSegments, getPathSegments(route.path));
};

/** Routes are included by default; the final matching rule wins. */
export const getApiRouterDecision = (route: ApiRoute, rules: readonly CompiledApiRouterRule[]): ApiRouterDecision => {
  const matchedRules = rules.filter((rule) => doesApiRouterRuleMatch(rule, route));
  const lastRule = matchedRules.at(-1);

  return { included: lastRule?.action !== 'exclude', matchedRules };
};

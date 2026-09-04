import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

import { compileApiRouterRules, getApiRouterDecision } from './router-rules';
import type { AnalyzeHonoApiOptions, AnalyzedHonoApiEndpoint, HonoApiAnalysis, HonoApiAnalysisSummary } from './types';
import { apiHttpMethods, type ApiHttpMethod } from './types';

export interface InternalEndpoint {
  path: string;
  method: ApiHttpMethod;
  type: ts.Type;
}

interface AnalysisContext {
  checker: ts.TypeChecker;
  route: ts.VariableDeclaration;
  endpoints: readonly InternalEndpoint[];
  options: AnalyzeHonoApiOptions;
}

const analysisContexts = new WeakMap<HonoApiAnalysis, AnalysisContext>();

const getUnionTypes = (type: ts.Type): readonly ts.Type[] => (type.isUnion() ? type.types : [type]);

const getRouteDeclaration = (sourceFile: ts.SourceFile, exportName: string): ts.VariableDeclaration => {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName) {
        return declaration;
      }
    }
  }

  throw new Error(`Unable to find route export ${JSON.stringify(exportName)} in ${sourceFile.fileName}`);
};

const getProgram = (tsconfigPath: string): ts.Program => {
  const config = ts.readConfigFile(tsconfigPath, (filePath) => ts.sys.readFile(filePath));

  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(tsconfigPath));
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics = ts.getPreEmitDiagnostics(program);

  if (diagnostics.length > 0) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => dirname(tsconfigPath),
        getNewLine: () => '\n',
      }),
    );
  }

  return program;
};

const getSchemaType = (checker: ts.TypeChecker, route: ts.VariableDeclaration): ts.Type => {
  const routeType = checker.getTypeAtLocation(route.name) as ts.Type & {
    aliasTypeArguments?: readonly ts.Type[];
    typeArguments?: readonly ts.Type[];
  };
  const schemaType = routeType.typeArguments?.[1] ?? routeType.aliasTypeArguments?.[1];

  if (!schemaType) {
    throw new Error('Unable to extract the second Hono schema type argument from the route export');
  }

  return schemaType;
};

export const analyzeHonoApi = (options: AnalyzeHonoApiOptions): HonoApiAnalysis => {
  const tsconfigPath = resolve(options.tsconfigPath);
  const routeFilePath = resolve(options.routeFilePath);
  const program = getProgram(tsconfigPath);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(routeFilePath);

  if (!sourceFile) {
    throw new Error(`Unable to find route source file: ${routeFilePath}`);
  }

  const route = getRouteDeclaration(sourceFile, options.routeExportName ?? 'route');
  const schemaType = getSchemaType(checker, route);
  const endpoints = new Map<string, InternalEndpoint>();

  for (const schemaPart of getUnionTypes(schemaType)) {
    for (const pathSymbol of checker.getPropertiesOfType(schemaPart)) {
      const name = pathSymbol.getName();
      const path = name.startsWith('/') ? name : `/${name}`;
      const pathType = checker.getTypeOfSymbolAtLocation(pathSymbol, route);

      for (const methodSymbol of checker.getPropertiesOfType(pathType)) {
        const honoMethod = methodSymbol.getName();

        if (!/^\$(get|post|put|patch|delete|head|options)$/u.test(honoMethod)) {
          continue;
        }

        const method = honoMethod.slice(1).toUpperCase() as ApiHttpMethod;

        if (!apiHttpMethods.includes(method)) {
          continue;
        }

        endpoints.set(`${path}\u0000${method}`, {
          path,
          method,
          type: checker.getTypeOfSymbolAtLocation(methodSymbol, route),
        });
      }
    }
  }

  const endpointList = [...endpoints.values()].sort(
    (left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
  );
  const routerRules = compileApiRouterRules(options.routerRules);
  const publicEndpoints: readonly AnalyzedHonoApiEndpoint[] = endpointList.map((endpoint) => ({
    path: endpoint.path,
    method: endpoint.method,
    decision: getApiRouterDecision(endpoint, routerRules),
  }));
  const matchCounts = new Map<number, number>();

  for (const endpoint of publicEndpoints) {
    for (const rule of endpoint.decision.matchedRules) {
      matchCounts.set(rule.index, (matchCounts.get(rule.index) ?? 0) + 1);
    }
  }

  const included = publicEndpoints.filter((endpoint) => endpoint.decision.included).length;
  const summary: HonoApiAnalysisSummary = {
    total: publicEndpoints.length,
    included,
    excluded: publicEndpoints.length - included,
    unmatchedRules: routerRules.filter((rule) => !matchCounts.has(rule.index)),
  };
  const analysis: HonoApiAnalysis = { endpoints: publicEndpoints, routerRules, summary };

  analysisContexts.set(analysis, { checker, route, endpoints: endpointList, options });
  return analysis;
};

export const getAnalysisContext = (analysis: HonoApiAnalysis): AnalysisContext => {
  const context = analysisContexts.get(analysis);

  if (!context) {
    throw new Error('This analysis was not created by analyzeHonoApi in the current process');
  }

  return context;
};

export const getIncludedEndpoints = (analysis: HonoApiAnalysis): readonly InternalEndpoint[] => {
  const context = getAnalysisContext(analysis);
  const includedKeys = new Set(
    analysis.endpoints
      .filter((endpoint) => endpoint.decision.included)
      .map((endpoint) => `${endpoint.path}\u0000${endpoint.method}`),
  );

  return context.endpoints.filter((endpoint) => includedKeys.has(`${endpoint.path}\u0000${endpoint.method}`));
};

export const getAnalysisOptions = (analysis: HonoApiAnalysis): AnalyzeHonoApiOptions =>
  getAnalysisContext(analysis).options;

export const getTypeContext = (analysis: HonoApiAnalysis): { checker: ts.TypeChecker; location: ts.Node } => {
  const context = getAnalysisContext(analysis);
  return { checker: context.checker, location: context.route };
};

export const readNearestPackageName = (sourceModuleSpecifier: string): string | undefined => {
  let directory = dirname(sourceModuleSpecifier);

  for (;;) {
    try {
      const packageJson = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as { name?: unknown };

      if (typeof packageJson.name === 'string' && packageJson.name.length > 0) {
        return packageJson.name;
      }
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }

    const parent = dirname(directory);

    if (parent === directory) {
      return undefined;
    }

    directory = parent;
  }
};

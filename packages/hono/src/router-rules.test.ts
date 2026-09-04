import { describe, expect, test } from 'bun:test';

import { compileApiRouterRules, doesApiRouterRuleMatch, getApiRouterDecision } from './index';

describe('API router rules', () => {
  test('includes a route when no rule matches', () => {
    const rules = compileApiRouterRules();

    expect(getApiRouterDecision({ method: 'GET', path: '/article/1' }, rules).included).toBe(true);
  });

  test('matches * as one segment and ** as zero or more segments', () => {
    const [oneSegment, descendant] = compileApiRouterRules([
      { action: 'exclude', path: '/article/*' },
      { action: 'exclude', path: '/poster/**' },
    ]);

    expect(doesApiRouterRuleMatch(oneSegment!, { method: 'GET', path: '/article/1' })).toBe(true);
    expect(doesApiRouterRuleMatch(oneSegment!, { method: 'GET', path: '/article/1/comment' })).toBe(false);
    expect(doesApiRouterRuleMatch(descendant!, { method: 'GET', path: '/poster' })).toBe(true);
    expect(doesApiRouterRuleMatch(descendant!, { method: 'GET', path: '/poster/share' })).toBe(true);
  });

  test('uses the final matching rule and respects method limits', () => {
    const rules = compileApiRouterRules([
      { action: 'exclude', path: '/poster/**' },
      { action: 'include', path: '/poster/share', methods: ['GET'] },
    ]);

    expect(getApiRouterDecision({ method: 'GET', path: '/poster/share' }, rules).included).toBe(true);
    expect(getApiRouterDecision({ method: 'POST', path: '/poster/share' }, rules).included).toBe(false);
  });

  test('rejects unsupported glob syntax', () => {
    expect(() => compileApiRouterRules([{ action: 'exclude', path: '/article/*.json' }])).toThrow(
      'Only full * and ** segments are supported',
    );
  });
});

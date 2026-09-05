import { describe, expect, test } from 'bun:test';

import { compileApiRouterRules, doesApiRouterRuleMatch, getApiRouterDecision } from './index';

describe('API router rules', () => {
  describe('compilation', () => {
    test('normalizes separators and trailing slashes', () => {
      const [rule] = compileApiRouterRules([{ action: 'exclude', path: '/article//**/comments/' }]);

      expect(rule?.pathSegments).toEqual(['article', '**', 'comments']);
    });

    test('rejects path patterns without a leading slash', () => {
      expect(() => compileApiRouterRules([{ action: 'exclude', path: 'article/**' }])).toThrow(
        'Route patterns must start with /',
      );
    });

    test('rejects unsupported glob syntax', () => {
      expect(() => compileApiRouterRules([{ action: 'exclude', path: '/article/*.json' }])).toThrow(
        'Only full * and ** segments are supported',
      );
    });
  });

  describe('matching', () => {
    test('matches * as exactly one segment', () => {
      const [rule] = compileApiRouterRules([{ action: 'exclude', path: '/article/*' }]);

      expect(doesApiRouterRuleMatch(rule!, { method: 'GET', path: '/article/1' })).toBe(true);
      expect(doesApiRouterRuleMatch(rule!, { method: 'GET', path: '/article/1/comment' })).toBe(false);
    });

    test('matches ** as zero or more segments, including in the middle of a path', () => {
      const [rule] = compileApiRouterRules([{ action: 'exclude', path: '/poster/**/comments' }]);

      expect(doesApiRouterRuleMatch(rule!, { method: 'GET', path: '/poster/comments' })).toBe(true);
      expect(doesApiRouterRuleMatch(rule!, { method: 'GET', path: '/poster/1/comments' })).toBe(true);
      expect(doesApiRouterRuleMatch(rule!, { method: 'GET', path: '/poster/1/replies/comments' })).toBe(true);
      expect(doesApiRouterRuleMatch(rule!, { method: 'GET', path: '/poster/1/replies' })).toBe(false);
    });

    test('respects method limits', () => {
      const [rule] = compileApiRouterRules([{ action: 'exclude', path: '/poster/**', methods: ['POST'] }]);

      expect(doesApiRouterRuleMatch(rule!, { method: 'POST', path: '/poster/1' })).toBe(true);
      expect(doesApiRouterRuleMatch(rule!, { method: 'GET', path: '/poster/1' })).toBe(false);
    });
  });

  describe('decisions', () => {
    test('includes a route when no rule matches', () => {
      const rules = compileApiRouterRules();

      expect(getApiRouterDecision({ method: 'GET', path: '/article/1' }, rules)).toEqual({
        included: true,
        matchedRules: [],
      });
    });

    test('uses the final matching rule while retaining every match for diagnostics', () => {
      const rules = compileApiRouterRules([
        { action: 'exclude', path: '/poster/**' },
        { action: 'include', path: '/poster/share', methods: ['GET'] },
      ]);

      const getDecision = getApiRouterDecision({ method: 'GET', path: '/poster/share' }, rules);
      const postDecision = getApiRouterDecision({ method: 'POST', path: '/poster/share' }, rules);

      expect(getDecision.included).toBe(true);
      expect(getDecision.matchedRules.map((rule) => rule.index)).toEqual([0, 1]);
      expect(postDecision.included).toBe(false);
      expect(postDecision.matchedRules.map((rule) => rule.index)).toEqual([0]);
    });
  });
});

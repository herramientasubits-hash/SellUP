// Q3F-10E.1 — provider workspace URL-state contract tests.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveProviderWorkspaceUrlState,
  buildProviderWorkspaceParams,
  DEFAULT_SIDEPANEL_TAB,
} from '../provider-workspace-url-state';

const VALID_KEYS = new Set(['apollo', 'lusha', 'tavily', 'anthropic']);

describe('resolveProviderWorkspaceUrlState', () => {
  it('no provider / no ptab -> closed workspace, default tab', () => {
    const result = resolveProviderWorkspaceUrlState({ provider: null, ptab: null }, VALID_KEYS);
    assert.deepEqual(result, { providerKey: null, tab: DEFAULT_SIDEPANEL_TAB });
  });

  it('valid provider / no ptab -> open workspace, default tab', () => {
    const result = resolveProviderWorkspaceUrlState({ provider: 'apollo', ptab: null }, VALID_KEYS);
    assert.deepEqual(result, { providerKey: 'apollo', tab: 'resumen' });
  });

  it('valid provider / default tab -> open workspace, default tab', () => {
    const result = resolveProviderWorkspaceUrlState({ provider: 'apollo', ptab: 'resumen' }, VALID_KEYS);
    assert.deepEqual(result, { providerKey: 'apollo', tab: 'resumen' });
  });

  it('valid provider / non-default valid tab -> open workspace, requested tab', () => {
    const result = resolveProviderWorkspaceUrlState({ provider: 'apollo', ptab: 'consumo' }, VALID_KEYS);
    assert.deepEqual(result, { providerKey: 'apollo', tab: 'consumo' });
  });

  it('invalid provider / valid ptab -> closed workspace, default tab (ptab has no meaning)', () => {
    const result = resolveProviderWorkspaceUrlState({ provider: 'not-a-real-provider', ptab: 'consumo' }, VALID_KEYS);
    assert.deepEqual(result, { providerKey: null, tab: DEFAULT_SIDEPANEL_TAB });
  });

  it('valid provider / invalid ptab -> open workspace, default tab', () => {
    const result = resolveProviderWorkspaceUrlState({ provider: 'apollo', ptab: 'garbage' }, VALID_KEYS);
    assert.deepEqual(result, { providerKey: 'apollo', tab: DEFAULT_SIDEPANEL_TAB });
  });

  it('no provider / valid ptab -> closed workspace (orphan ptab has no meaning)', () => {
    const result = resolveProviderWorkspaceUrlState({ provider: null, ptab: 'consumo' }, VALID_KEYS);
    assert.deepEqual(result, { providerKey: null, tab: DEFAULT_SIDEPANEL_TAB });
  });

  it('every current tab key resolves as valid', () => {
    for (const tab of ['resumen', 'configuracion', 'consumo', 'presupuesto', 'efectividad', 'logs']) {
      const result = resolveProviderWorkspaceUrlState({ provider: 'lusha', ptab: tab }, VALID_KEYS);
      assert.equal(result.tab, tab);
    }
  });
});

describe('buildProviderWorkspaceParams', () => {
  it('opening a provider on the default tab sets provider only', () => {
    const current = new URLSearchParams('');
    const next = buildProviderWorkspaceParams(current, { providerKey: 'apollo', tab: 'resumen' });
    assert.equal(next.toString(), 'provider=apollo');
  });

  it('opening a provider on a non-default tab sets both params', () => {
    const current = new URLSearchParams('');
    const next = buildProviderWorkspaceParams(current, { providerKey: 'apollo', tab: 'consumo' });
    assert.equal(next.toString(), 'provider=apollo&ptab=consumo');
  });

  it('switching provider replaces both params deterministically (no stale ptab)', () => {
    const current = new URLSearchParams('provider=apollo&ptab=consumo');
    const next = buildProviderWorkspaceParams(current, { providerKey: 'lusha', tab: 'resumen' });
    assert.equal(next.toString(), 'provider=lusha');
  });

  it('changing tab to non-default preserves provider and sets ptab', () => {
    const current = new URLSearchParams('provider=apollo');
    const next = buildProviderWorkspaceParams(current, { providerKey: 'apollo', tab: 'logs' });
    assert.equal(next.toString(), 'provider=apollo&ptab=logs');
  });

  it('changing tab back to default removes ptab', () => {
    const current = new URLSearchParams('provider=apollo&ptab=logs');
    const next = buildProviderWorkspaceParams(current, { providerKey: 'apollo', tab: 'resumen' });
    assert.equal(next.toString(), 'provider=apollo');
  });

  it('closing removes both provider and ptab', () => {
    const current = new URLSearchParams('provider=apollo&ptab=consumo');
    const next = buildProviderWorkspaceParams(current, { providerKey: null, tab: null });
    assert.equal(next.toString(), '');
  });

  it('unrelated search params are preserved through open, tab-change, and close', () => {
    const opened = buildProviderWorkspaceParams(new URLSearchParams('foo=bar'), { providerKey: 'apollo', tab: 'consumo' });
    assert.equal(opened.toString(), 'foo=bar&provider=apollo&ptab=consumo');

    const tabChanged = buildProviderWorkspaceParams(opened, { providerKey: 'apollo', tab: 'logs' });
    assert.equal(tabChanged.toString(), 'foo=bar&provider=apollo&ptab=logs');

    const closed = buildProviderWorkspaceParams(tabChanged, { providerKey: null, tab: null });
    assert.equal(closed.toString(), 'foo=bar');
  });
});

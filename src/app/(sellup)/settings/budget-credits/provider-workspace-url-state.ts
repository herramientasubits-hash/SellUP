// Pure URL-state contract for the primary provider workspace sidepanel
// (Q3F-10E.1). Plain module (no 'use client'/'use server') so it stays
// directly unit-testable, following the pattern in budget-display.ts.
//
// Canonical URL: /settings/providers?provider=<providerKey>&ptab=<tabKey>

import type { SidepanelInitialTab } from '../providers/provider-detail-sidepanel';

export const DEFAULT_SIDEPANEL_TAB: SidepanelInitialTab = 'resumen';

const VALID_SIDEPANEL_TABS: readonly SidepanelInitialTab[] = [
  'resumen',
  'configuracion',
  'consumo',
  'presupuesto',
  'efectividad',
  'logs',
];

export function isValidSidepanelTab(value: string | null): value is SidepanelInitialTab {
  return value != null && (VALID_SIDEPANEL_TABS as readonly string[]).includes(value);
}

export interface ProviderWorkspaceUrlState {
  /** Resolved provider key, or null when no provider workspace should be open. */
  providerKey: string | null;
  /** Resolved active tab. Only meaningful when providerKey is non-null. */
  tab: SidepanelInitialTab;
}

/**
 * Resolves the desired workspace state from raw `provider`/`ptab` query values.
 * Exact-key matching only — no fuzzy/partial provider lookup. An invalid
 * provider key collapses to a closed workspace; an invalid tab collapses to
 * the default tab. A ptab without a valid provider carries no meaning.
 */
export function resolveProviderWorkspaceUrlState(
  raw: { provider: string | null; ptab: string | null },
  validProviderKeys: ReadonlySet<string>,
): ProviderWorkspaceUrlState {
  const providerKey = raw.provider != null && validProviderKeys.has(raw.provider) ? raw.provider : null;
  if (providerKey === null) return { providerKey: null, tab: DEFAULT_SIDEPANEL_TAB };

  const tab = isValidSidepanelTab(raw.ptab) ? raw.ptab : DEFAULT_SIDEPANEL_TAB;
  return { providerKey, tab };
}

/**
 * Builds the next query params for a workspace navigation, preserving every
 * unrelated existing param. The default tab is never written as `ptab` —
 * that keeps the canonical URL free of a redundant param when the panel is
 * on its normal starting tab.
 */
export function buildProviderWorkspaceParams(
  current: URLSearchParams,
  next: { providerKey: string | null; tab: SidepanelInitialTab | null },
): URLSearchParams {
  const params = new URLSearchParams(current.toString());

  if (!next.providerKey) {
    params.delete('provider');
    params.delete('ptab');
    return params;
  }

  params.set('provider', next.providerKey);
  if (next.tab && next.tab !== DEFAULT_SIDEPANEL_TAB) {
    params.set('ptab', next.tab);
  } else {
    params.delete('ptab');
  }
  return params;
}

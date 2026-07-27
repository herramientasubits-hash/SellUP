/**
 * Prospect Discovery Provider Resolution — Q3F-5BB.3D
 *
 * Pure decision layer that picks the internal discovery provider for the
 * "Generar con IA" wizard. Lusha is a HIDDEN provider: the user never chooses
 * it. When the criteria are compatible (companies-by-criteria + a mapped sector
 * + a supported country) and the preview flag is on, the wizard runs Lusha
 * under the hood; otherwise it keeps the existing default behavior.
 *
 * Design rules:
 *   - Pure: no side effects, no I/O, no env reads, no network, no DB.
 *   - Client-safe: imports only pure mapping helpers already used by the client
 *     wizard (`resolveLushaSectorOption`, `resolveLushaCountryName`).
 *   - This module NEVER runs Lusha; it only classifies criteria. The explicit
 *     search click (elsewhere) is still the only thing that can call Lusha.
 */

import { resolveLushaSectorOption } from '@/server/prospect-batches/lusha-sector-mapping';
import { resolveLushaCountryName } from '@/server/prospect-batches/lusha-preview';

/**
 * Canonical "companies by criteria" search type. In the chat wizard this is the
 * `exploratory` search mode (labeled "Empresas por criterios"). The spec name
 * `companies_by_criteria` is also accepted so callers can use either token.
 */
export const COMPANIES_BY_CRITERIA_SEARCH_TYPES: ReadonlySet<string> = new Set([
  'exploratory',
  'companies_by_criteria',
]);

/**
 * Q3F-5BB.10C3-FIX-1 (P0-2): three-state routing.
 *   - `lusha`                  — Lusha-eligible criteria AND the preview flag is on.
 *   - `blocked_lusha_disabled` — Lusha-eligible criteria BUT the preview flag is
 *                                off/absent. STRICT-ALL fail-closed: the wizard
 *                                must BLOCK, never fall back to `default_ai`.
 *   - `default_ai`             — the criteria are NOT Lusha-eligible; existing
 *                                Agent 1 behavior is preserved unchanged.
 *
 * Invariant: a Lusha-eligible intent NEVER resolves to `default_ai`. Eligibility
 * is decided BEFORE the flag, so the flag can only ever gate a Lusha row between
 * `lusha` (on) and `blocked_lusha_disabled` (off) — it can never demote it to the
 * default-AI generation path (the path that spends provider credits).
 */
export type ProspectDiscoveryProvider =
  | 'lusha'
  | 'blocked_lusha_disabled'
  | 'default_ai';

export interface ProspectDiscoveryCriteria {
  /** Mirrors ENABLE_LUSHA_PREVIEW — when false, Lusha is never selected. */
  lushaPreviewEnabled: boolean;
  /** Search type / mode. Only companies-by-criteria is Lusha-eligible. */
  searchType?: string | null;
  /** Lusha sector key (e.g. 'healthcare'). Must map to a Lusha industry. */
  sectorKey?: string | null;
  /** ISO2 country code (e.g. 'CO'). Must be a Lusha-supported country. */
  countryCode?: string | null;
}

export interface ProspectDiscoveryDecision {
  provider: ProspectDiscoveryProvider;
  /** Machine-readable reason for the decision (telemetry / tests / copy). */
  reason: string;
}

/**
 * Pure predicate: are the given criteria Lusha-eligible? Eligibility is the
 * search-shape test — companies-by-criteria + a mapped sector + a supported
 * country — and is deliberately INDEPENDENT of the preview flag. The flag only
 * decides whether an eligible search runs (`lusha`) or is blocked
 * (`blocked_lusha_disabled`); it can never change eligibility.
 */
export function isProspectLushaEligible(
  criteria: Omit<ProspectDiscoveryCriteria, 'lushaPreviewEnabled'>,
): boolean {
  const searchType = criteria.searchType?.trim() ?? '';
  if (!COMPANIES_BY_CRITERIA_SEARCH_TYPES.has(searchType)) return false;
  if (!resolveLushaSectorOption(criteria.sectorKey)) return false;
  if (!resolveLushaCountryName(criteria.countryCode)) return false;
  return true;
}

/**
 * Decide which discovery provider the wizard should use for the given criteria.
 *
 * Q3F-5BB.10C3-FIX-1 (P0-2) — eligibility is resolved FIRST, then the flag:
 *   - not Lusha-eligible                 → `default_ai` (existing behavior)
 *   - Lusha-eligible + preview flag off  → `blocked_lusha_disabled` (FAIL CLOSED)
 *   - Lusha-eligible + preview flag on   → `lusha`
 *
 * The previous ordering checked the flag first and returned `default_ai` when it
 * was off — which, for Lusha-eligible criteria, silently degraded the request
 * onto the Agent 1 generation path. Deciding eligibility first makes that
 * impossible: an eligible intent can only be `lusha` or `blocked_lusha_disabled`.
 */
export function resolveProspectDiscoveryProvider(
  criteria: ProspectDiscoveryCriteria,
): ProspectDiscoveryDecision {
  const searchType = criteria.searchType?.trim() ?? '';
  if (!COMPANIES_BY_CRITERIA_SEARCH_TYPES.has(searchType)) {
    return { provider: 'default_ai', reason: 'search_type_not_criteria' };
  }

  if (!resolveLushaSectorOption(criteria.sectorKey)) {
    return { provider: 'default_ai', reason: 'sector_not_mapped' };
  }

  if (!resolveLushaCountryName(criteria.countryCode)) {
    return { provider: 'default_ai', reason: 'country_not_supported' };
  }

  // Lusha-eligible from here down. The flag can only gate on/off — never demote.
  if (!criteria.lushaPreviewEnabled) {
    return { provider: 'blocked_lusha_disabled', reason: 'lusha_preview_disabled' };
  }

  return { provider: 'lusha', reason: 'criteria_compatible' };
}

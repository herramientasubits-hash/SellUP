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

export type ProspectDiscoveryProvider = 'lusha' | 'default_ai';

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
 * Decide which discovery provider the wizard should use for the given criteria.
 * Returns `default_ai` (existing behavior) unless every Lusha precondition is
 * met, in which case it returns `lusha`.
 */
export function resolveProspectDiscoveryProvider(
  criteria: ProspectDiscoveryCriteria,
): ProspectDiscoveryDecision {
  if (!criteria.lushaPreviewEnabled) {
    return { provider: 'default_ai', reason: 'lusha_preview_disabled' };
  }

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

  return { provider: 'lusha', reason: 'criteria_compatible' };
}

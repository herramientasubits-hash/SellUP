/**
 * Wizard → Lusha criteria resolution — Q3F-5BB.3E
 *
 * Pure client-safe bridge between the CONVERSATIONAL "Generar con IA" wizard and
 * the HIDDEN Lusha discovery provider. The conversational wizard already collects
 * país / industria / subindustria / criterio adicional step by step; this module
 * translates that collected state into the read-only Lusha preview input and
 * decides — via the pure `resolveProspectDiscoveryProvider` — whether Lusha backs
 * the final search at all.
 *
 * Design rules (unchanged from the hidden-provider contract):
 *   - Pure: no side effects, no I/O, no env reads, no network, no DB.
 *   - Client-safe: imports only pure mapping helpers (already used client-side).
 *   - NEVER runs Lusha. It only classifies criteria + builds the input object.
 *     The explicit final "Buscar con IA" click is still the only thing that can
 *     call Lusha (see `WizardLushaFinalSearch`).
 *   - NEVER invents sectors/ids. Sub-industry is left null: there is no reliable
 *     catalog→Lusha sub-industry mapping, so the mapped `mainIndustriesId`
 *     (server-derived from sectorKey) is the sole industry filter.
 */

import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import { resolveLushaMainIndustryMapping } from '@/server/prospect-batches/lusha-sector-mapping';
import { LUSHA_PREVIEW_DEFAULT_SIZE_BAND_KEY } from '@/server/prospect-batches/lusha-preview';
import {
  resolveProspectDiscoveryProvider,
  type ProspectDiscoveryProvider,
} from '@/modules/prospect-batches/prospect-discovery-provider';

/** Canonical "companies by criteria" search type (chat wizard `exploratory`). */
const CRITERIA_SEARCH_TYPE = 'exploratory';

/** Collected wizard criteria needed to resolve the hidden provider. */
export interface WizardLushaCriteriaState {
  countryCode: string | null;
  industryId: string | null;
  subindustryIds: string[];
  additionalCriteriaRaw: string | null;
}

/** Read-only Lusha preview input built from the wizard's collected criteria. */
export interface WizardLushaInput {
  countryCode: string;
  sectorKey: string;
  subIndustryId: number | null;
  sizeBandKey: string;
  searchText: string | null;
}

export interface WizardLushaCriteriaDecision {
  provider: ProspectDiscoveryProvider;
  reason: string;
  /** Non-null only when `provider === 'lusha'`. */
  input: WizardLushaInput | null;
}

/**
 * Resolve the discovery provider + read-only Lusha input for the wizard's final
 * search step. Returns `default_ai` (existing behavior, `input: null`) unless the
 * preview flag is on AND the collected industria maps to a single Lusha sector
 * AND the país is Lusha-supported.
 */
export function resolveWizardLushaCriteria(
  state: WizardLushaCriteriaState,
  catalog: ActiveIndustryCatalog,
  lushaPreviewEnabled: boolean,
): WizardLushaCriteriaDecision {
  const industryName =
    catalog.industries.find((i) => i.id === state.industryId)?.name ?? null;
  const subsegments = catalog.subindustries
    .filter((s) => state.subindustryIds.includes(s.id))
    .map((s) => s.name);

  const mapping = resolveLushaMainIndustryMapping({
    sector: industryName,
    subsegments,
  });
  const sectorKey = mapping.matchedSector;

  const decision = resolveProspectDiscoveryProvider({
    lushaPreviewEnabled,
    searchType: CRITERIA_SEARCH_TYPE,
    sectorKey,
    countryCode: state.countryCode,
  });

  if (decision.provider !== 'lusha' || !sectorKey || !state.countryCode) {
    return { provider: 'default_ai', reason: decision.reason, input: null };
  }

  const searchText = state.additionalCriteriaRaw?.trim();

  return {
    provider: 'lusha',
    reason: decision.reason,
    input: {
      countryCode: state.countryCode,
      sectorKey,
      // No reliable catalog→Lusha sub-industry mapping — never invent one.
      subIndustryId: null,
      sizeBandKey: LUSHA_PREVIEW_DEFAULT_SIZE_BAND_KEY,
      searchText: searchText && searchText.length > 0 ? searchText : null,
    },
  };
}

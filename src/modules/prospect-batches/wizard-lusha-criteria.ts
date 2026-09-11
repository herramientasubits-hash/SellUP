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
 * ── AGENT1-LUSHA-MACRO-V2-ROUTING-CUTOVER-1 §§ 1, 2, 5 ────────────────────────
 *
 * Aquí estaba el corazón de la doble autoridad, y es lo que este hito retira.
 *
 * El camino anterior era: `industryId` → NOMBRE VISIBLE de la industria →
 * `resolveLushaMainIndustryMapping` (coincidencia difusa de alias contra tres
 * sectores legacy) → `LushaSectorKey` → y ya en el servidor, de vuelta a una macro
 * industria. Cuatro traducciones para volver al punto de partida, con dos efectos
 * que no eran teóricos:
 *
 *   · nueve de las doce macro no tenían alias en el catálogo legacy, así que
 *     caían en `no_sector_match` y su búsqueda degradaba a `default_ai` aunque su
 *     plan Lusha existiera y su reserva fuera calculable;
 *   · la coincidencia era por SUBCADENA sobre texto visible, de modo que el
 *     nombre de una macro —o de un subsegmento— podía activar un sector que nadie
 *     había elegido. `education` seguía siendo alcanzable así.
 *
 * Ahora el puente es directo: `industryId` → fila del catálogo → `slug` →
 * `MacroIndustryKey` → capacidad Lusha. Sin texto visible, sin alias, sin
 * subcadenas. § 4 del catálogo macro ya fijaba la regla que esto respeta: ninguna
 * decisión puede depender del nombre visible.
 *
 * Design rules (unchanged from the hidden-provider contract):
 *   - Pure: no side effects, no I/O, no env reads, no network, no DB.
 *   - Client-safe: imports only pure mapping helpers (already used client-side).
 *   - NEVER runs Lusha. It only classifies criteria + builds the input object.
 *     The explicit final "Buscar con IA" click is still the only thing that can
 *     call Lusha (see `WizardLushaFinalSearch`).
 *   - NEVER invents industries/ids. Sub-industry is left null: bajo la taxonomía
 *     Macro-v2 no hay subindustrias que seleccionar, y las ramas del plan —que
 *     sí llevan sub-industrias de Lusha— las resuelve el servidor desde el
 *     catálogo, nunca el navegador.
 */

import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import { type MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
// AGENT1-MACRO-RESOLUTION-SINGLE-AUTHORITY-1 — la precedencia que este fichero
// documentaba es AHORA la autoridad compartida, en vez de una implementación
// local que las demás puntas copiaban (unas completa, otras truncada).
import { resolveMacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industry-resolution';
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
  /**
   * § 2 — clave canónica de macro industria. Es lo único que viaja como
   * identidad de industria desde el wizard hasta el servidor.
   *
   * 🔴 No convive con un `sectorKey`: el campo legacy se retiró de esta
   * superficie precisamente para que no puedan discrepar (§ 5).
   */
  macroIndustryKey: MacroIndustryKey;
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
 * La macro industria que la usuaria eligió, resuelta desde el CATÁLOGO.
 *
 * La precedencia —`slug` → nombre visible canónico → `null`— la define
 * `resolveMacroIndustryKey`, la autoridad única. Este fichero la documentaba y la
 * implementaba a la vez, y esa implementación local fue la que otras puntas
 * copiaron a medias: la pierna Lusha y la capa gratuita se quedaron en el paso
 * del slug, así que una industria cuyo slug publicado no casaba salía `null`
 * aquí abajo mientras Apollo sí la resolvía por nombre.
 *
 * `null` cuando la industria seleccionada no es una macro del catálogo canónico:
 * bajo la taxonomía v1 (8 industrias legacy) eso es lo normal y significa
 * «esta búsqueda no tiene ruta Lusha», nunca «bloquea».
 */
export function resolveWizardMacroIndustryKey(
  state: Pick<WizardLushaCriteriaState, 'industryId'>,
  catalog: ActiveIndustryCatalog,
): MacroIndustryKey | null {
  const industry = catalog.industries.find((entry) => entry.id === state.industryId) ?? null;
  if (!industry) return null;

  return resolveMacroIndustryKey({ slug: industry.slug, displayName: industry.name });
}

/**
 * Resolve the discovery provider + read-only Lusha input for the wizard's final
 * search step. Returns `default_ai` (existing behavior, `input: null`) unless the
 * preview flag is on AND the collected industria is a ROUTABLE Macro-v2 industry
 * AND the país is Lusha-supported.
 */
export function resolveWizardLushaCriteria(
  state: WizardLushaCriteriaState,
  catalog: ActiveIndustryCatalog,
  lushaPreviewEnabled: boolean,
): WizardLushaCriteriaDecision {
  const macroIndustryKey = resolveWizardMacroIndustryKey(state, catalog);

  const decision = resolveProspectDiscoveryProvider({
    lushaPreviewEnabled,
    searchType: CRITERIA_SEARCH_TYPE,
    macroIndustryKey,
    countryCode: state.countryCode,
  });

  // Only the `lusha` decision carries a read-only input. Q3F-5BB.10C3-FIX-1:
  // preserve `blocked_lusha_disabled` (and `default_ai`) verbatim instead of
  // collapsing everything non-lusha into `default_ai` — otherwise a blocked,
  // Lusha-eligible search would look identical to a genuine default-AI search
  // and the UI could fall through to the Agent 1 generation path.
  if (decision.provider !== 'lusha' || !macroIndustryKey || !state.countryCode) {
    return { provider: decision.provider, reason: decision.reason, input: null };
  }

  const searchText = state.additionalCriteriaRaw?.trim();

  return {
    provider: 'lusha',
    reason: decision.reason,
    input: {
      countryCode: state.countryCode,
      macroIndustryKey,
      // Las sub-industrias de Lusha viajan DENTRO de las ramas del plan, que el
      // servidor resuelve desde el catálogo. El navegador nunca elige una.
      subIndustryId: null,
      sizeBandKey: LUSHA_PREVIEW_DEFAULT_SIZE_BAND_KEY,
      searchText: searchText && searchText.length > 0 ? searchText : null,
    },
  };
}

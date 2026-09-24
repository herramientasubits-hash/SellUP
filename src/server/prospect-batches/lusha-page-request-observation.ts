/**
 * lusha-page-request-observation.ts — qué se le PIDIÓ a Lusha en una página y
 * qué DEVOLVIÓ.
 *
 * AGENT1-LUSHA-REQUEST-OBSERVABILITY-1.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * El 2026-09-24, en CO × Consumo Masivo, las dos ramas de Lusha —Manufactura ›
 * Alimentos y Bebidas, y Manufactura › Cuidado Personal— devolvieron 48 de 50
 * empresas IGUALES, y 46 de 47 se rechazaron por venir sólo con la industria
 * madre. El código SÍ envía `subIndustriesIds` (las dos subindustrias son válidas
 * bajo Manufactura). Lo que no se podía saber es si Lusha lo aplica: el log de
 * uso guardaba los IDs PLANIFICADOS de cada rama, no lo que la petición llevó, ni
 * qué industrias volvieron.
 *
 * Esta observación responde dos preguntas sin volver a pagar:
 *
 *   · ¿el filtro de subindustria llega y Lusha lo respeta? — lo pedido frente a
 *     la distribución de industrias devuelta;
 *   · ¿Lusha aplica el tamaño mínimo? — cuántas empresas vienen por debajo del
 *     mínimo pedido (hoy el suelo de 200 se aplica EN LOCAL, CUT-5A, porque el
 *     filtro del proveedor no tiene contrato verificado).
 *
 * 🔴 Es SÓLO observación: no cambia qué se pide, cuánto se paga ni qué se acepta.
 * Sin nombres, dominios ni identificadores de empresa: sólo etiquetas de
 * industria y conteos.
 *
 * Puro: sin env, sin I/O, sin reloj.
 */

import type { LushaPreviewResult } from './lusha-preview';

/** Industrias listadas por página; el resto se cuenta, no se lista. */
export const LUSHA_PAGE_REQUEST_TOP_INDUSTRIES = 8;

const MAX_LABEL_LENGTH = 80;

export type LushaPageRequestObservation = {
  branchIndex: number;
  page: number;
  /** Lo que la petición LLEVÓ, tal como lo resolvió el constructor. */
  requested: {
    mainIndustryIds: number[];
    subIndustryId: number | null;
    sizeBand: { min?: number; max?: number } | null;
    hasSearchText: boolean;
    /** Avisos del constructor, p. ej. `branch_subindustry_not_under_main`. */
    warnings: string[];
  };
  /** Lo que la respuesta TRAJO. */
  returned: {
    results: number;
    industries: { industry: string; count: number }[];
    otherIndustriesCount: number;
    industryMissing: number;
    /**
     * Contra el mínimo de la banda PEDIDA. Sin banda pedida, todo es `unknown`:
     * no se puede estar «por debajo» de un mínimo que no se pidió.
     */
    sizeVsRequestedMin: { atOrAbove: number; below: number; unknown: number };
  };
};

type SearchView = Pick<LushaPreviewResult, 'requestSummary' | 'results' | 'warnings'>;

function cleanLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length > MAX_LABEL_LENGTH ? trimmed.slice(0, MAX_LABEL_LENGTH) : trimmed;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * ¿La empresa está por encima o por debajo del mínimo pedido?
 *
 * Con cantidad exacta, se compara esa. Con un rango, sólo se afirma lo que el
 * rango permite: por debajo si su MÁXIMO no llega; por encima si su MÍNIMO ya
 * llega. Un rango que cruza el mínimo no permite afirmar nada.
 */
function sizeSide(
  company: SearchView['results'][number],
  requestedMin: number | null,
): 'atOrAbove' | 'below' | 'unknown' {
  if (requestedMin === null) return 'unknown';
  const exact = finite(company.employeesExact);
  if (exact !== null) return exact >= requestedMin ? 'atOrAbove' : 'below';
  const min = finite(company.employeesMin);
  const max = finite(company.employeesMax);
  if (max !== null && max < requestedMin) return 'below';
  if (min !== null && min >= requestedMin) return 'atOrAbove';
  return 'unknown';
}

export function observeLushaPageRequest(input: {
  branchIndex: number;
  page: number;
  search: SearchView;
}): LushaPageRequestObservation {
  const summary = input.search.requestSummary;
  const results = Array.isArray(input.search.results) ? input.search.results : [];

  const byIndustry = new Map<string, number>();
  let industryMissing = 0;
  const sizeVsRequestedMin = { atOrAbove: 0, below: 0, unknown: 0 };
  const requestedMin = finite(summary?.sizeBand?.min ?? null);

  for (const company of results) {
    const label = cleanLabel(company.industry);
    if (label === null) industryMissing += 1;
    else byIndustry.set(label, (byIndustry.get(label) ?? 0) + 1);
    sizeVsRequestedMin[sizeSide(company, requestedMin)] += 1;
  }

  const ranked = [...byIndustry.entries()]
    .map(([industry, count]) => ({ industry, count }))
    .sort((a, b) => b.count - a.count || a.industry.localeCompare(b.industry));
  const listed = ranked.slice(0, LUSHA_PAGE_REQUEST_TOP_INDUSTRIES);
  const otherIndustriesCount = ranked
    .slice(LUSHA_PAGE_REQUEST_TOP_INDUSTRIES)
    .reduce((total, entry) => total + entry.count, 0);

  return {
    branchIndex: input.branchIndex,
    page: input.page,
    requested: {
      mainIndustryIds: Array.isArray(summary?.mainIndustriesIds)
        ? [...summary.mainIndustriesIds]
        : [],
      subIndustryId: finite(summary?.subIndustryId ?? null),
      sizeBand: summary?.sizeBand ? { ...summary.sizeBand } : null,
      hasSearchText: summary?.hasSearchText === true,
      warnings: Array.isArray(input.search.warnings) ? [...input.search.warnings] : [],
    },
    returned: {
      results: results.length,
      industries: listed,
      otherIndustriesCount,
      industryMissing,
      sizeVsRequestedMin,
    },
  };
}

/** Vista serializable para `metadata`. snake_case, como el resto del lote. */
export function toLushaPageRequestMetadata(
  observations: readonly LushaPageRequestObservation[],
): Record<string, unknown>[] {
  return observations.map((o) => ({
    branch_index: o.branchIndex,
    page: o.page,
    requested: {
      main_industry_ids: [...o.requested.mainIndustryIds],
      sub_industry_id: o.requested.subIndustryId,
      size_band: o.requested.sizeBand,
      has_search_text: o.requested.hasSearchText,
      warnings: [...o.requested.warnings],
    },
    returned: {
      results: o.returned.results,
      industries: o.returned.industries.map((i) => ({ industry: i.industry, count: i.count })),
      other_industries_count: o.returned.otherIndustriesCount,
      industry_missing: o.returned.industryMissing,
      size_vs_requested_min: {
        at_or_above: o.returned.sizeVsRequestedMin.atOrAbove,
        below: o.returned.sizeVsRequestedMin.below,
        unknown: o.returned.sizeVsRequestedMin.unknown,
      },
    },
  }));
}

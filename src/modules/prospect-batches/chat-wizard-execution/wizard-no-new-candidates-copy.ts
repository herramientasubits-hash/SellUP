/**
 * wizard-no-new-candidates-copy.ts — Qué se le dice al usuario cuando una
 * corrida no dejó ninguna empresa nueva.
 *
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 · § 8.
 *
 * El defecto observado: la corrida QA `edb6f40c` mostró «Todos los resultados ya
 * habían sido sugeridos recientemente o no pasaron los filtros de calidad»
 * cuando `skipped_recent_count = 0` y NINGÚN resultado había sido sugerido
 * antes. El copy era una disyunción genérica que describía dos causas posibles
 * sin comprobar cuál había ocurrido, así que resultaba engañoso justo en el
 * momento en que el usuario necesita entender qué cambiar.
 *
 * Aquí el copy se DERIVA de la distribución real de descartes. Cuando no hay
 * distribución que leer, se dice eso, no se elige una causa al azar.
 *
 * Puro: sin I/O, sin React, sin env. Se testea sin navegador.
 */

// ─── Entrada ──────────────────────────────────────────────────────────────────

export type NoNewCandidatesBreakdown = {
  /**
   * Resultados descartados por historial: ya sugeridos, en cooldown, o
   * duplicados de SellUp/HubSpot.
   */
  recentlySuggestedCount: number;
  /**
   * Resultados descartados por país, sector, identidad o dominio: los «filtros
   * de calidad» en el sentido literal.
   */
  qualityRejectedCount: number;
  /** El universo con estos criterios ya se exploró: no queda nada nuevo que traer. */
  noveltyExhausted: boolean;
  /** Motivo por el que la ronda 2 no corrió. Alimenta la nota de auditoría. */
  secondRoundSkippedReason?: string | null;
};

/** Causa REAL del resultado vacío, derivada de la distribución. */
export type NoNewCandidatesCause =
  | 'novelty_exhausted'
  | 'all_recently_suggested'
  | 'all_quality_rejected'
  | 'mixed'
  | 'no_results_at_all';

export type NoNewCandidatesCopy = {
  cause: NoNewCandidatesCause;
  /** Texto para el usuario final. */
  body: string;
  /**
   * Nota administrativa o de auditoría. NO se muestra al usuario final: una
   * ronda omitida por parámetros idénticos es un hecho de la ejecución, no algo
   * que el usuario pueda accionar.
   */
  auditNote: string | null;
};

// ─── Resolución ───────────────────────────────────────────────────────────────

const COPY_BY_CAUSE: Readonly<Record<NoNewCandidatesCause, string>> = {
  novelty_exhausted:
    'El universo de empresas disponibles con estos criterios ya fue explorado recientemente. ' +
    'Intenta cambiar la industria, el país o los criterios adicionales.',
  all_recently_suggested: 'Todos los resultados ya habían sido sugeridos recientemente.',
  all_quality_rejected:
    'Los resultados encontrados no superaron los filtros de país, sector, identidad o calidad.',
  mixed:
    'Algunos resultados ya habían sido sugeridos y los demás no superaron los filtros de calidad.',
  no_results_at_all:
    'La búsqueda no devolvió empresas que pudiéramos evaluar con estos criterios.',
};

/**
 * Nota de auditoría cuando la ronda 2 se omitió por enviar los mismos
 * parámetros. Es información de ejecución, no de producto.
 */
export const IDENTICAL_PROVIDER_REQUEST_AUDIT_NOTE =
  'La segunda ronda no se ejecutó: los parámetros normalizados que se habrían ' +
  'enviado al proveedor eran idénticos a los de la primera ronda. No se consumió ' +
  'ningún crédito adicional.';

/**
 * Copy derivado de la distribución REAL de descartes.
 *
 * Reglas:
 *   - el universo agotado gana sobre todo lo demás: es la única causa que le
 *     dice al usuario que no hay nada que reintentar;
 *   - sólo se afirma «ya sugeridos» cuando el conteo de historial es > 0;
 *   - sólo se afirma «no pasaron los filtros» cuando el conteo de calidad es > 0;
 *   - con ambos en cero no se elige ninguna de las dos: no hubo resultados que
 *     clasificar, y decir lo contrario es exactamente el defecto que se corrige.
 */
export function resolveNoNewCandidatesCopy(
  breakdown: NoNewCandidatesBreakdown,
): NoNewCandidatesCopy {
  const recent = Math.max(0, Math.trunc(breakdown.recentlySuggestedCount));
  const quality = Math.max(0, Math.trunc(breakdown.qualityRejectedCount));

  const auditNote =
    breakdown.secondRoundSkippedReason === 'identical_provider_request'
      ? IDENTICAL_PROVIDER_REQUEST_AUDIT_NOTE
      : null;

  const cause: NoNewCandidatesCause = breakdown.noveltyExhausted
    ? 'novelty_exhausted'
    : recent > 0 && quality > 0
      ? 'mixed'
      : recent > 0
        ? 'all_recently_suggested'
        : quality > 0
          ? 'all_quality_rejected'
          : 'no_results_at_all';

  return { cause, body: COPY_BY_CAUSE[cause], auditNote };
}

// ─── Derivación desde la observabilidad del pipeline ──────────────────────────

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Proyecta la distribución de descartes desde el metadata que el pipeline dejó.
 *
 * Fuente preferente: la observabilidad por ronda de la modalidad de dos rondas,
 * que ya separa historial (`known_company_duplicates`, `seen_duplicates`) de
 * calidad (`country_rejected`, `sector_rejected`, `ownership_rejected`).
 * Como respaldo, `skipped_recent_count` de la ruta legacy.
 *
 * Nunca lanza: un metadata con forma inesperada produce ceros, y ceros producen
 * el copy honesto de «no hubo resultados que clasificar».
 */
export function buildNoNewCandidatesBreakdown(
  metadata: unknown,
  observabilityKey: string,
): NoNewCandidatesBreakdown {
  const empty: NoNewCandidatesBreakdown = {
    recentlySuggestedCount: 0,
    qualityRejectedCount: 0,
    noveltyExhausted: false,
    secondRoundSkippedReason: null,
  };
  if (!metadata || typeof metadata !== 'object') return empty;
  const root = metadata as Record<string, unknown>;

  const noveltyExhausted = root['novelty_exhausted'] === true;
  const legacyRecent = readNumber(root['skipped_recent_count']);

  const observability = root[observabilityKey];
  if (!observability || typeof observability !== 'object') {
    return {
      recentlySuggestedCount: legacyRecent,
      qualityRejectedCount: 0,
      noveltyExhausted,
      secondRoundSkippedReason: null,
    };
  }

  const block = observability as Record<string, unknown>;
  const rounds = Array.isArray(block['rounds']) ? (block['rounds'] as unknown[]) : [];

  let recent = legacyRecent;
  let quality = 0;
  for (const round of rounds) {
    if (!round || typeof round !== 'object') continue;
    const r = round as Record<string, unknown>;
    recent += readNumber(r['known_company_duplicates']) + readNumber(r['seen_duplicates']);
    quality +=
      readNumber(r['country_rejected']) +
      readNumber(r['sector_rejected']) +
      readNumber(r['ownership_rejected']);
  }

  const skippedReason = block['second_round_skipped_reason'];

  return {
    recentlySuggestedCount: recent,
    qualityRejectedCount: quality,
    noveltyExhausted,
    secondRoundSkippedReason: typeof skippedReason === 'string' ? skippedReason : null,
  };
}

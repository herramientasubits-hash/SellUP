/**
 * wizard-no-new-candidates-copy.ts — Qué se le dice al usuario cuando una
 * corrida no dejó ninguna empresa nueva.
 *
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 § 8 · AGENT1-APOLLO-SCALE-AND-SECOND-ROUND-FIX-1 § 5.
 *
 * El defecto original: la corrida QA `edb6f40c` mostró «Todos los resultados ya
 * habían sido sugeridos recientemente o no pasaron los filtros de calidad»
 * cuando `skipped_recent_count = 0` y NINGÚN resultado había sido sugerido
 * antes. El copy era una disyunción genérica que describía dos causas posibles
 * sin comprobar cuál había ocurrido.
 *
 * El defecto siguiente (LIVE-QA-2, lote `62fdf47b`): el mismo resolutor sumaba
 * duplicados de HubSpot, duplicados de SellUp, cooldown real y repeticiones
 * entre rondas en UN solo número (`recentlySuggestedCount`) y lo llamaba
 * «sugeridos recientemente» aunque ninguna de esas empresas hubiera sido
 * sugerida antes por SellUp — sólo existían ya en otro catálogo. Aquí cada
 * causa tiene su propio contador y su propio texto: un duplicado de HubSpot no
 * es un cooldown, y un cooldown no es una repetición entre rondas.
 *
 * Puro: sin I/O, sin React, sin env. Se testea sin navegador.
 */

// ─── Entrada ──────────────────────────────────────────────────────────────────

export type NoNewCandidatesBreakdown = {
  /** Duplicado confirmado en HubSpot. */
  hubspotDuplicateCount: number;
  /** Duplicado confirmado en SellUp. */
  sellupDuplicateCount: number;
  /**
   * Cooldown real o sugerencia previa del propio wizard. NUNCA un duplicado de
   * catálogo: una empresa puede estar en cooldown sin existir aún en HubSpot ni
   * en SellUp.
   */
  cooldownCount: number;
  /**
   * Misma organización repetida — dentro de una respuesta o entre rondas.
   *
   * Cuenta EVENTOS de repetición, no empresas únicas: es la ronda 2 devolviendo
   * de nuevo lo que la ronda 1 ya trajo. No participa en la elección de causa —
   * una organización repetida ya se contó (o se rechazó) la primera vez que
   * apareció, y contarla otra vez inflaría el desglose con la misma empresa.
   */
  repeatedAcrossRoundsCount: number;
  /**
   * País, sector, identidad o dominio insuficientes: los «filtros de calidad»
   * en el sentido literal.
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
  | 'cooldown'
  | 'duplicates'
  | 'insufficient_evidence'
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
  cooldown: 'Algunas empresas ya habían sido sugeridas recientemente.',
  duplicates: 'Los resultados encontrados ya existen en SellUp o HubSpot.',
  insufficient_evidence: 'Las empresas encontradas no cumplieron los criterios de sector y calidad.',
  mixed:
    'No se encontraron empresas nuevas que cumplieran todos los criterios. ' +
    'Revisa el desglose de duplicados y validaciones.',
  no_results_at_all: 'La búsqueda no devolvió empresas que pudiéramos evaluar con estos criterios.',
};

/**
 * Nota de auditoría cuando la ronda 2 se omitió por enviar los mismos
 * parámetros. Es información de ejecución, no de producto.
 */
export const IDENTICAL_PROVIDER_REQUEST_AUDIT_NOTE =
  'La segunda ronda no se ejecutó: los parámetros normalizados que se habrían ' +
  'enviado al proveedor eran idénticos a los de la primera ronda. No se consumió ' +
  'ningún crédito adicional.';

function nonNegativeInt(value: number): number {
  return Math.max(0, Math.trunc(value));
}

/**
 * Copy derivado de la distribución REAL de descartes, en causas MUTUAMENTE
 * EXCLUYENTES.
 *
 * Reglas:
 *   - el universo agotado gana sobre todo lo demás: es la única causa que le
 *     dice al usuario que no hay nada que reintentar;
 *   - si más de una de {duplicados, cooldown, calidad} ocurrió, la causa es
 *     `mixed` — nombrar sólo una sería tan engañoso como el defecto original;
 *   - `duplicates` cubre HubSpot y SellUp juntos: para el usuario ambos dicen
 *     lo mismo ("esto ya existe"), aunque el desglose interno los separe;
 *   - `repeatedAcrossRoundsCount` NUNCA participa en la elección de causa: es un
 *     conteo de eventos, no de empresas, y ya se decidió por la primera
 *     aparición de esa organización;
 *   - con las tres cubetas en cero no se elige ninguna: no hubo resultados que
 *     clasificar, y decir lo contrario es exactamente el defecto que se corrige.
 */
export function resolveNoNewCandidatesCopy(
  breakdown: NoNewCandidatesBreakdown,
): NoNewCandidatesCopy {
  const hubspot = nonNegativeInt(breakdown.hubspotDuplicateCount);
  const sellup = nonNegativeInt(breakdown.sellupDuplicateCount);
  const cooldown = nonNegativeInt(breakdown.cooldownCount);
  const quality = nonNegativeInt(breakdown.qualityRejectedCount);
  const duplicates = hubspot + sellup;

  const activeCauseCount = [duplicates > 0, cooldown > 0, quality > 0].filter(Boolean).length;

  const auditNote =
    breakdown.secondRoundSkippedReason === 'identical_provider_request'
      ? IDENTICAL_PROVIDER_REQUEST_AUDIT_NOTE
      : null;

  const cause: NoNewCandidatesCause = breakdown.noveltyExhausted
    ? 'novelty_exhausted'
    : activeCauseCount >= 2
      ? 'mixed'
      : duplicates > 0
        ? 'duplicates'
        : cooldown > 0
          ? 'cooldown'
          : quality > 0
            ? 'insufficient_evidence'
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
 * que separa HubSpot (`duplicate_in_hubspot`), SellUp (`duplicate_in_sellup`),
 * cooldown (`cooldown_or_prior_suggestion`), repeticiones entre rondas
 * (`seen_duplicates`) y calidad (`country_rejected` + `sector_rejected` +
 * `ownership_rejected`).
 *
 * Un metadata escrito ANTES de este hito no trae los tres campos granulares de
 * duplicados — sólo el agregado `known_company_duplicates` — y aquí no se
 * reparte a ciegas: repartirlo sería inventar una atribución que nadie observó.
 * Ese caso legacy cae a `skipped_recent_count` como respaldo de cooldown, igual
 * que hacía el resolutor anterior.
 *
 * Nunca lanza: un metadata con forma inesperada produce ceros, y ceros producen
 * el copy honesto de «no hubo resultados que clasificar».
 */
export function buildNoNewCandidatesBreakdown(
  metadata: unknown,
  observabilityKey: string,
): NoNewCandidatesBreakdown {
  const empty: NoNewCandidatesBreakdown = {
    hubspotDuplicateCount: 0,
    sellupDuplicateCount: 0,
    cooldownCount: 0,
    repeatedAcrossRoundsCount: 0,
    qualityRejectedCount: 0,
    noveltyExhausted: false,
    secondRoundSkippedReason: null,
  };
  if (!metadata || typeof metadata !== 'object') return empty;
  const root = metadata as Record<string, unknown>;

  const noveltyExhausted = root['novelty_exhausted'] === true;
  const legacyCooldown = readNumber(root['skipped_recent_count']);

  const observability = root[observabilityKey];
  if (!observability || typeof observability !== 'object') {
    return {
      ...empty,
      cooldownCount: legacyCooldown,
      noveltyExhausted,
    };
  }

  const block = observability as Record<string, unknown>;
  const rounds = Array.isArray(block['rounds']) ? (block['rounds'] as unknown[]) : [];

  let hubspot = 0;
  let sellup = 0;
  let cooldown = legacyCooldown;
  let repeatedAcrossRounds = 0;
  let quality = 0;
  for (const round of rounds) {
    if (!round || typeof round !== 'object') continue;
    const r = round as Record<string, unknown>;
    hubspot += readNumber(r['duplicate_in_hubspot']);
    sellup += readNumber(r['duplicate_in_sellup']);
    cooldown += readNumber(r['cooldown_or_prior_suggestion']);
    repeatedAcrossRounds += readNumber(r['seen_duplicates']);
    quality +=
      readNumber(r['country_rejected']) +
      readNumber(r['sector_rejected']) +
      readNumber(r['ownership_rejected']);
  }

  const skippedReason = block['second_round_skipped_reason'];

  return {
    hubspotDuplicateCount: hubspot,
    sellupDuplicateCount: sellup,
    cooldownCount: cooldown,
    repeatedAcrossRoundsCount: repeatedAcrossRounds,
    qualityRejectedCount: quality,
    noveltyExhausted,
    secondRoundSkippedReason: typeof skippedReason === 'string' ? skippedReason : null,
  };
}

// ─── Desglose compacto para la UI ─────────────────────────────────────────────

/** § 5 — lo que el panel muestra, en el orden en que el usuario debe leerlo. */
export type NoNewCandidatesCompactBreakdown = {
  uniqueResultsCount: number;
  hubspotDuplicateCount: number;
  sellupDuplicateCount: number;
  cooldownCount: number;
  repeatedAcrossRoundsCount: number;
  qualityRejectedCount: number;
  candidatesCreatedCount: number;
};

/**
 * Ensambla el desglose compacto del § 5: resultados únicos, duplicados por
 * fuente, cooldown, repeticiones entre rondas, rechazos de calidad y
 * candidatos creados.
 *
 * `uniqueResultsCount` y `candidatesCreatedCount` llegan por parámetro porque
 * viven fuera de esta observabilidad (el conteo de únicas es del run completo,
 * y los candidatos creados son la cifra de persistencia, no de descubrimiento).
 */
export function buildNoNewCandidatesCompactBreakdown(
  breakdown: NoNewCandidatesBreakdown,
  totals: { uniqueResultsCount: number; candidatesCreatedCount: number },
): NoNewCandidatesCompactBreakdown {
  return {
    uniqueResultsCount: nonNegativeInt(totals.uniqueResultsCount),
    hubspotDuplicateCount: nonNegativeInt(breakdown.hubspotDuplicateCount),
    sellupDuplicateCount: nonNegativeInt(breakdown.sellupDuplicateCount),
    cooldownCount: nonNegativeInt(breakdown.cooldownCount),
    repeatedAcrossRoundsCount: nonNegativeInt(breakdown.repeatedAcrossRoundsCount),
    qualityRejectedCount: nonNegativeInt(breakdown.qualityRejectedCount),
    candidatesCreatedCount: nonNegativeInt(totals.candidatesCreatedCount),
  };
}

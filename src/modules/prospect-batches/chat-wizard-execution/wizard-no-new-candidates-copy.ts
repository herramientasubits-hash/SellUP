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
   *
   * HARDENING-1 § 6 — se conserva porque el resolutor de copy la usa para ELEGIR
   * causa, y ahí las tres significan lo mismo: «la empresa no encajaba». El
   * desglose VISIBLE, en cambio, usa los tres campos separados de abajo.
   */
  qualityRejectedCount: number;
  /** § 6 — descartes por país, con nombre propio. */
  countryRejectedCount: number;
  /** § 6 — descartes por sector o subindustria, con nombre propio. */
  sectorRejectedCount: number;
  /**
   * § 6 — descartes por OWNERSHIP: el dominio no acredita pertenecer a la empresa
   * nombrada. No es un juicio de calidad, y mezclarlo con uno mandaba a buscar la
   * causa al sitio equivocado.
   */
  ownershipRejectedCount: number;
  /**
   * SCALE-SECOND-ROUND-FIX-1B § 3 — empresas ÚNICAS que la corrida llegó a ver.
   *
   * Es el denominador honesto del desglose: la corrida live `eae6d47f` devolvió 10
   * resultados crudos y sólo 5 empresas únicas, porque la ronda 2 repitió las de la
   * ronda 1. Mostrar «10 encontradas» habría contado dos veces las mismas cinco.
   *
   * Opcional: un metadata escrito antes de este hito no trae la cifra, y en ese caso
   * se muestra 0 en vez de inventar un total.
   */
  uniqueResultsCount?: number;
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

function nonNegativeInt(value: number | undefined): number {
  // Un valor ausente o no finito es «no se sabe», y en un conteo eso se muestra
  // como 0, nunca como NaN.
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
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
    countryRejectedCount: 0,
    sectorRejectedCount: 0,
    ownershipRejectedCount: 0,
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

  // § 3 — empresas ÚNICAS, no resultados crudos. La ronda 2 que repite lo que la
  // ronda 1 ya trajo NO añade empresas, y el desglose no puede decir que sí.
  const runMetrics =
    block['run_metrics'] && typeof block['run_metrics'] === 'object'
      ? (block['run_metrics'] as Record<string, unknown>)
      : null;
  const uniqueResultsCount = readNumber(runMetrics?.['total_unique_organizations']);

  let hubspot = 0;
  let sellup = 0;
  let cooldown = legacyCooldown;
  let repeatedAcrossRounds = 0;
  // § 6 — las tres causas se acumulan POR SEPARADO y sólo se suman al final para
  // el resolutor de copy. Sumarlas aquí es lo que hacía imposible que la UI
  // dijera cuál de las tres había ocurrido.
  let countryRejected = 0;
  let sectorRejected = 0;
  let ownershipRejected = 0;
  for (const round of rounds) {
    if (!round || typeof round !== 'object') continue;
    const r = round as Record<string, unknown>;
    hubspot += readNumber(r['duplicate_in_hubspot']);
    sellup += readNumber(r['duplicate_in_sellup']);
    cooldown += readNumber(r['cooldown_or_prior_suggestion']);
    repeatedAcrossRounds += readNumber(r['seen_duplicates']);
    countryRejected += readNumber(r['country_rejected']);
    sectorRejected += readNumber(r['sector_rejected']);
    ownershipRejected += readNumber(r['ownership_rejected']);
  }
  const quality = countryRejected + sectorRejected + ownershipRejected;

  const skippedReason = block['second_round_skipped_reason'];

  return {
    hubspotDuplicateCount: hubspot,
    sellupDuplicateCount: sellup,
    cooldownCount: cooldown,
    repeatedAcrossRoundsCount: repeatedAcrossRounds,
    qualityRejectedCount: quality,
    countryRejectedCount: countryRejected,
    sectorRejectedCount: sectorRejected,
    ownershipRejectedCount: ownershipRejected,
    uniqueResultsCount,
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
  /**
   * § 6 — las tres causas, separadas, tal como se pintan. El agregado
   * `qualityRejectedCount` NO viaja al desglose visible: pintarlo junto a sus
   * tres partes contaría cada descarte dos veces.
   */
  countryRejectedCount: number;
  sectorRejectedCount: number;
  ownershipRejectedCount: number;
  candidatesCreatedCount: number;
};

/**
 * Ensambla el desglose compacto del § 5: resultados únicos, duplicados por
 * fuente, cooldown, repeticiones entre rondas, rechazos de calidad y
 * candidatos creados.
 *
 * `candidatesCreatedCount` llega por parámetro porque vive fuera de esta
 * observabilidad: es la cifra de persistencia, no de descubrimiento.
 * `uniqueResultsCount` se toma del desglose cuando el llamador no lo aporta — es la
 * misma cifra de empresas únicas que el pipeline ya observó.
 */
export function buildNoNewCandidatesCompactBreakdown(
  breakdown: NoNewCandidatesBreakdown,
  totals: { uniqueResultsCount?: number; candidatesCreatedCount: number },
): NoNewCandidatesCompactBreakdown {
  return {
    uniqueResultsCount: nonNegativeInt(totals.uniqueResultsCount ?? breakdown.uniqueResultsCount),
    hubspotDuplicateCount: nonNegativeInt(breakdown.hubspotDuplicateCount),
    sellupDuplicateCount: nonNegativeInt(breakdown.sellupDuplicateCount),
    cooldownCount: nonNegativeInt(breakdown.cooldownCount),
    repeatedAcrossRoundsCount: nonNegativeInt(breakdown.repeatedAcrossRoundsCount),
    countryRejectedCount: nonNegativeInt(breakdown.countryRejectedCount),
    sectorRejectedCount: nonNegativeInt(breakdown.sectorRejectedCount),
    ownershipRejectedCount: nonNegativeInt(breakdown.ownershipRejectedCount),
    candidatesCreatedCount: nonNegativeInt(totals.candidatesCreatedCount),
  };
}

// ─── Filas del desglose que la UI pinta ───────────────────────────────────────

/**
 * SCALE-SECOND-ROUND-FIX-1B § 3 — etiqueta de cada cifra.
 *
 * Vive aquí, y no en el componente, para que el texto sea testeable sin navegador y
 * para que ninguna pantalla invente una etiqueta propia. Ninguna menciona «ya
 * sugeridos recientemente» salvo la que de verdad cuenta cooldown: ése era el copy
 * que la corrida live mostró con `skipped_recent_count = 0`.
 */
export const NO_NEW_CANDIDATES_BREAKDOWN_LABELS: Readonly<
  Record<keyof NoNewCandidatesCompactBreakdown, string>
> = {
  uniqueResultsCount: 'Empresas únicas encontradas',
  hubspotDuplicateCount: 'Ya existían en HubSpot',
  sellupDuplicateCount: 'Ya existían en SellUp',
  cooldownCount: 'Sugeridas recientemente (en enfriamiento)',
  repeatedAcrossRoundsCount: 'Repeticiones de la misma empresa entre rondas',
  // § 6 — una etiqueta por causa. La anterior, «Descartadas por país, sector o
  // calidad», obligaba a adivinar cuál de las tres había ocurrido y ni siquiera
  // nombraba el ownership, que fue la causa real del único descarte de la
  // corrida `be181d2d`.
  countryRejectedCount: 'Descartadas por país',
  sectorRejectedCount: 'Descartadas por sector o subindustria',
  ownershipRejectedCount: 'Descartadas porque el dominio no acredita a la empresa',
  candidatesCreatedCount: 'Candidatos creados',
};

/**
 * § 3 — aclaración de la fila de repeticiones.
 *
 * Es la línea que impide leer el desglose como si sumara empresas: una organización
 * que la ronda 2 vuelve a traer NO es una empresa más. En la corrida live eso era la
 * diferencia entre «10 empresas encontradas» y las 5 reales.
 */
export const REPEATED_ACROSS_ROUNDS_HINT =
  'No cuentan como empresas nuevas: es la misma empresa vista otra vez.';

export type NoNewCandidatesBreakdownRow = {
  key: keyof NoNewCandidatesCompactBreakdown;
  label: string;
  count: number;
  /** Aclaración bajo la fila, cuando la cifra puede malinterpretarse. */
  hint: string | null;
};

/**
 * § 3 — filas a pintar, en orden de lectura.
 *
 * `uniqueResultsCount` y `candidatesCreatedCount` se muestran siempre: son el marco
 * («cuántas empresas vimos» y «cuántos candidatos quedaron»). Las causas sólo
 * aparecen cuando REALMENTE ocurrieron — una fila «HubSpot: 0» afirmaría haber
 * comprobado algo que no ocurrió, que es la clase de afirmación que este hito
 * elimina.
 */
export function toNoNewCandidatesBreakdownRows(
  compact: NoNewCandidatesCompactBreakdown,
): NoNewCandidatesBreakdownRow[] {
  const row = (
    key: keyof NoNewCandidatesCompactBreakdown,
    hint: string | null = null,
  ): NoNewCandidatesBreakdownRow => ({
    key,
    label: NO_NEW_CANDIDATES_BREAKDOWN_LABELS[key],
    count: compact[key],
    hint,
  });

  const causes: Array<keyof NoNewCandidatesCompactBreakdown> = [
    'hubspotDuplicateCount',
    'sellupDuplicateCount',
    'cooldownCount',
    'repeatedAcrossRoundsCount',
    'countryRejectedCount',
    'sectorRejectedCount',
    'ownershipRejectedCount',
  ];

  return [
    row('uniqueResultsCount'),
    ...causes
      .filter((key) => compact[key] > 0)
      .map((key) => row(key, key === 'repeatedAcrossRoundsCount' ? REPEATED_ACROSS_ROUNDS_HINT : null)),
    row('candidatesCreatedCount'),
  ];
}

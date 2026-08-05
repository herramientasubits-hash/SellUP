/**
 * candidate-skip-reason-taxonomy.ts — Clasificación de los descartes del writer
 * por su MOTIVO REAL.
 *
 * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 · § 6.
 *
 * El defecto que cierra: `writer_summary.quality_skipped_count` era una cubeta
 * cajón de sastre. En la corrida `be181d2d…` esa cifra valía 1 y la única empresa
 * descartada lo fue por OWNERSHIP —el dominio `supermu.com` no acredita
 * pertenecer a «Supermercado La Vaquita»—, no por calidad. Quien leía el resumen
 * concluía «la empresa era de baja calidad» sobre un hecho que decía otra cosa,
 * y por tanto buscaba la corrección donde no estaba.
 *
 * Una decisión de ownership es una decisión de IDENTIDAD: dice «no puedo
 * demostrar que este dominio sea de esta empresa», no «esta empresa no sirve».
 * Mezclarlas hace que ninguna de las dos se pueda medir ni corregir.
 *
 * Puro: sin I/O, sin reloj.
 */

/**
 * Cubetas mutuamente excluyentes. Un descarte pertenece a UNA.
 *
 * `other` no es un sinónimo de calidad: es «este motivo no está clasificado», y
 * verlo crecer significa que la taxonomía se quedó corta, no que haya bajado la
 * calidad.
 */
export type CandidateSkipCategory =
  | 'ownership_rejected'
  | 'quality_rejected'
  | 'sector_rejected'
  | 'country_rejected'
  | 'duplicate_hubspot'
  | 'duplicate_sellup'
  | 'cooldown'
  | 'novelty_rejected'
  | 'identity_gate_rejected'
  | 'target_cap'
  | 'persistence_failed'
  | 'other';

/** Motivos exactos, sin prefijo. */
const EXACT_REASON_CATEGORY: Record<string, CandidateSkipCategory> = {
  // Identidad: el dominio no acredita pertenecer a la empresa nombrada.
  non_company_phrase: 'identity_gate_rejected',
  non_official_source_domain: 'identity_gate_rejected',
  intra_batch_identity_duplicate: 'identity_gate_rejected',
  seen_identity_key_recently: 'novelty_rejected',
  // Historial y memoria negativa.
  seen_in_previous_batch_recently: 'novelty_rejected',
  confirmed_duplicate_previous: 'novelty_rejected',
  rejected_recently: 'cooldown',
  negative_memory_rejected_recently: 'cooldown',
  // País.
  country_incompatible: 'country_rejected',
  missing_country_code: 'country_rejected',
  // Calidad y naturaleza del sitio.
  'qualityLabel=discard': 'quality_rejected',
  content_page: 'quality_rejected',
  blog_content_site: 'quality_rejected',
  not_a_direct_vendor: 'quality_rejected',
  content_or_intermediary_site: 'quality_rejected',
  icp_size_below_threshold: 'quality_rejected',
  // Tope del objetivo: no es un rechazo, es que ya había suficientes.
  target_cap: 'target_cap',
};

/**
 * Prefijos `motivo:detalle`. El orden importa donde uno es prefijo de otro, así
 * que se comprueba la coincidencia más larga primero.
 */
const PREFIX_REASON_CATEGORY: readonly [string, CandidateSkipCategory][] = [
  ['company_ownership:', 'ownership_rejected'],
  ['apollo_sector_relevance:', 'sector_rejected'],
  ['sector_relevance:', 'sector_rejected'],
  ['country_incompatible:', 'country_rejected'],
  ['persistence_failed:', 'persistence_failed'],
  ['duplicate_guard:', 'duplicate_sellup'],
  ['external_platform:', 'quality_rejected'],
  ['source_url_quality:', 'quality_rejected'],
  ['business_fit:', 'quality_rejected'],
  ['evidence_policy:', 'quality_rejected'],
  ['icp_size:', 'quality_rejected'],
  ['duplicate_in_hubspot', 'duplicate_hubspot'],
  ['duplicate_in_sellup', 'duplicate_sellup'],
];

/**
 * Clasifica un motivo de descarte.
 *
 * Un motivo desconocido cae en `other`, NUNCA en `quality_rejected`: el sesgo por
 * defecto que este hito elimina es exactamente el de atribuir a calidad lo que no
 * se sabe clasificar.
 */
export function classifyCandidateSkipReason(reason: string): CandidateSkipCategory {
  const exact = EXACT_REASON_CATEGORY[reason];
  if (exact !== undefined) return exact;

  const matches = PREFIX_REASON_CATEGORY.filter(([prefix]) => reason.startsWith(prefix));
  if (matches.length === 0) return 'other';

  // Coincidencia más larga: `country_incompatible:` antes que un prefijo corto
  // que también encajara.
  return matches.reduce((best, current) =>
    current[0].length > best[0].length ? current : best,
  )[1];
}

/** Recuento por cubeta. Todas presentes, incluso en cero, para que el desglose sume. */
export type CandidateSkipBreakdown = Record<CandidateSkipCategory, number>;

const EMPTY_BREAKDOWN: CandidateSkipBreakdown = {
  ownership_rejected: 0,
  quality_rejected: 0,
  sector_rejected: 0,
  country_rejected: 0,
  duplicate_hubspot: 0,
  duplicate_sellup: 0,
  cooldown: 0,
  novelty_rejected: 0,
  identity_gate_rejected: 0,
  target_cap: 0,
  persistence_failed: 0,
  other: 0,
};

/**
 * Desglosa una lista de descartes.
 *
 * Invariante: la suma de las cubetas es igual al número de descartes recibidos.
 * Un descarte no puede desaparecer del desglose ni contarse dos veces.
 */
export function buildCandidateSkipBreakdown(
  skipped: readonly { reason: string }[],
): CandidateSkipBreakdown {
  const breakdown: CandidateSkipBreakdown = { ...EMPTY_BREAKDOWN };
  for (const entry of skipped) {
    breakdown[classifyCandidateSkipReason(entry.reason)] += 1;
  }
  return breakdown;
}

/** Proyección a metadata, con los nombres del § 6. */
export function toCandidateSkipBreakdownMetadata(
  breakdown: CandidateSkipBreakdown,
): Record<string, number> {
  return {
    ownership_rejected_count: breakdown.ownership_rejected,
    quality_rejected_count: breakdown.quality_rejected,
    sector_rejected_count: breakdown.sector_rejected,
    country_rejected_count: breakdown.country_rejected,
    duplicate_hubspot_count: breakdown.duplicate_hubspot,
    duplicate_sellup_count: breakdown.duplicate_sellup,
    cooldown_count: breakdown.cooldown,
    novelty_rejected_count: breakdown.novelty_rejected,
    identity_gate_rejected_count: breakdown.identity_gate_rejected,
    target_cap_count: breakdown.target_cap,
    persistence_failed_count: breakdown.persistence_failed,
    unclassified_count: breakdown.other,
  };
}

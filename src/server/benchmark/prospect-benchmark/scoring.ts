/**
 * Prospect Generation Benchmark — Scoring & Métricas (Hito 16AB.23.1)
 *
 * Calcula el score técnico 0-100 basado en candidatos VERIFICADOS, no en strings no vacíos.
 * Aplica caps duros para evitar scores falsos positivos.
 * Sin llamadas externas. Completamente determinístico.
 */

import type {
  BenchmarkCandidate,
  BenchmarkMetrics,
  CapApplication,
  CandidatePhaseResult,
  DiversificationMetrics,
  PoolMetrics,
  ProviderRunResult,
  RejectedCandidate,
  ScoreBreakdown,
  VerifiedBenchmarkCandidate,
} from './types';

// ─── URL validation ───────────────────────────────────────────────────────────

function isValidUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

// ─── Hosts que no cuentan como sitio oficial ──────────────────────────────────

const NON_OFFICIAL_HOSTS = new Set([
  'reddit.com', 'www.reddit.com',
  'google.com', 'www.google.com',
  'wikipedia.org', 'es.wikipedia.org',
  'linkedin.com', 'www.linkedin.com',
  'twitter.com', 'x.com',
  'facebook.com', 'www.facebook.com',
  'instagram.com', 'www.instagram.com',
  'youtube.com', 'www.youtube.com',
  'latamfintech.co', 'www.latamfintech.co',
  'colombiafintech.co', 'www.colombiafintech.co',
]);

function isOfficialSiteUrl(url: string | null): boolean {
  if (!isValidUrl(url)) return false;
  try {
    const host = new URL(url!).hostname.toLowerCase();
    return !NON_OFFICIAL_HOSTS.has(host);
  } catch {
    return false;
  }
}

// ─── Completeness por candidato ───────────────────────────────────────────────

const CONTRACT_FIELDS: Array<keyof BenchmarkCandidate> = [
  'name', 'country', 'sector', 'website', 'linkedin',
  'city', 'estimated_size', 'description',
  'evidence_url', 'evidence_source', 'confidence', 'notes',
];

function candidateCompleteness(c: BenchmarkCandidate): number {
  const filled = CONTRACT_FIELDS.filter((f) => {
    const v = c[f];
    return v !== null && v !== undefined && String(v).trim() !== '';
  });
  return filled.length / CONTRACT_FIELDS.length;
}

// ─── Fortaleza de evidencia (basada en URLs realmente verificadas) ────────────

const STRONG_EVIDENCE_HOSTS = new Set([
  'rues.gov.co',
  'superfinanciera.gov.co',
  'supersociedades.gov.co',
  'confecamaras.co',
  'camara.ccb.org.co',
  'fedesoft.com.co',
]);

function evidenceStrength(
  c: VerifiedBenchmarkCandidate | BenchmarkCandidate,
): 'official' | 'strong' | 'weak' | 'none' {
  const hasVerifiedSite = 'official_website_url' in c
    ? isOfficialSiteUrl((c as VerifiedBenchmarkCandidate).official_website_url)
    : isOfficialSiteUrl(c.website);

  const evidenceUrl = c.evidence_url;
  if (!hasVerifiedSite && !isValidUrl(evidenceUrl)) return 'none';

  // Official registry
  try {
    const evHost = evidenceUrl ? new URL(evidenceUrl).hostname.toLowerCase() : '';
    if (STRONG_EVIDENCE_HOSTS.has(evHost)) return 'official';
  } catch { /* ignore */ }

  // LinkedIn corporativo (confirmado o http_unverified/found)
  if ('linkedin_status' in c) {
    const ls = (c as VerifiedBenchmarkCandidate).linkedin_status;
    if (ls === 'confirmed' || ls === 'http_unverified' || ls === 'found') return 'official';
  }
  if (isValidUrl(c.linkedin) && c.linkedin?.includes('linkedin.com/company/')) return 'official';

  // Official site confirmed
  if (hasVerifiedSite) return 'strong';

  // Has evidence URL at all
  if (isValidUrl(evidenceUrl)) return 'strong';

  return 'weak';
}

// ─── Diversificación ─────────────────────────────────────────────────────────

export function computeDiversification(
  candidates: (BenchmarkCandidate | VerifiedBenchmarkCandidate)[],
): DiversificationMetrics {
  const cityCount: Record<string, number> = {};
  const subsectorCount: Record<string, number> = {};
  const sizeCount: Record<string, number> = {};

  for (const c of candidates) {
    const city = (c.city ?? 'Desconocida').trim();
    cityCount[city] = (cityCount[city] ?? 0) + 1;

    // Don't count bare "Tecnología" as a distinct subsector
    const rawSector = (c.sector ?? '').split('/')[0].trim();
    const subsector = rawSector === 'Tecnología' || rawSector === 'Tecnologia' || rawSector === 'Technology'
      ? 'Tecnología (genérico)'
      : rawSector;
    subsectorCount[subsector] = (subsectorCount[subsector] ?? 0) + 1;

    const size = c.estimated_size ?? 'No disponible';
    sizeCount[size] = (sizeCount[size] ?? 0) + 1;
  }

  const maxCity = Object.entries(cityCount).sort((a, b) => b[1] - a[1])[0] ?? ['?', 0];
  const maxSub = Object.entries(subsectorCount).sort((a, b) => b[1] - a[1])[0] ?? ['?', 0];

  return {
    cities_distinct: Object.keys(cityCount).filter((k) => k !== 'Desconocida').length,
    subsectors_distinct: Object.keys(subsectorCount).filter((k) => k !== 'Tecnología (genérico)').length,
    max_concentration_city: { city: maxCity[0], count: maxCity[1] },
    max_concentration_subsector: { subsector: maxSub[0], count: maxSub[1] },
    size_distribution: sizeCount,
  };
}

// ─── Score hardened — calculado sobre candidatos verificados ─────────────────

export function computeHardenedScore(
  verifiedCandidates: VerifiedBenchmarkCandidate[],
  allRejected: RejectedCandidate[],
  rawCount: number,
  duplicatesFound: number,
  diversification: DiversificationMetrics,
): {
  score_before_caps: number;
  score_after_caps: number;
  breakdown: ScoreBreakdown;
  caps_applied: CapApplication[];
} {
  const n = verifiedCandidates.length;
  const empty = { veracidad_identidad: 0, ajuste_pais_sector: 0, calidad_evidencia: 0, completitud: 0, novedad_sin_duplicados: 0, diversificacion: 0 };

  if (n === 0) {
    return { score_before_caps: 0, score_after_caps: 0, breakdown: empty, caps_applied: [] };
  }

  const trulyVerified = verifiedCandidates.filter((c) => c.is_verified_company);
  const tv = trulyVerified.length;

  // 25 pts — Veracidad e identidad
  // Only award if: entity=company, name verified, domain official, correspondence confirmed, activity confirmed
  const withOfficialSite = verifiedCandidates.filter((c) => isOfficialSiteUrl(c.official_website_url)).length;
  const withResolvedIdentity = verifiedCandidates.filter((c) => c.identity_resolution?.resolved_company_name || c.is_verified_company).length;
  const veracidad = Math.round(
    (withOfficialSite / n) * 12 +
    (withResolvedIdentity / n) * 8 +
    (tv / n) * 5,
  );

  // 20 pts — Ajuste país-sector
  // Requires evidence field, not just model-declared country
  const withColombiaEvidence = verifiedCandidates.filter((c) => c.colombia_evidence).length;
  const withTechSector = verifiedCandidates.filter((c) => {
    const s = (c.sector ?? '').toLowerCase();
    return s.includes('tecnol') || s.includes('tech') || s.includes('software') || s.includes('digital') ||
      s.includes('fintech') || s.includes('saas') || s.includes('datos') || s.includes('ciberseg');
  }).length;
  const ajuste = Math.round(
    (withColombiaEvidence / n) * 10 +
    (withTechSector / n) * 10,
  );

  // 20 pts — Calidad de evidencia
  const strengths = verifiedCandidates.map(evidenceStrength);
  const officialCount = strengths.filter((s) => s === 'official').length;
  const strongCount = strengths.filter((s) => s === 'strong').length;
  const evidencia = Math.min(20, Math.round(
    (officialCount / n) * 20 +
    (strongCount / n) * 10,
  ));

  // 15 pts — Completitud (based on verified fields only)
  const avgCompleteness = verifiedCandidates.reduce((sum, c) => sum + candidateCompleteness(c), 0) / n;
  const completitud = Math.round(avgCompleteness * 15);

  // 10 pts — Novedad y ausencia de duplicados
  const duplicatePenalty = Math.min(duplicatesFound * 2, 10);
  const novedad = Math.max(0, 10 - duplicatePenalty);

  // 10 pts — Diversificación (only verified cities/subsectors)
  const verifiedWithCity = verifiedCandidates.filter((c) => c.city).length;
  const citiesScore = Math.min(diversification.cities_distinct * 2, 6);
  const subScore = Math.min(diversification.subsectors_distinct * 2, 4);
  const diversificacion = verifiedWithCity === 0 ? 0 : Math.round(citiesScore + subScore);

  const rawScore = veracidad + ajuste + evidencia + completitud + novedad + diversificacion;

  // ─── Apply caps ─────────────────────────────────────────────────────────────
  const caps: CapApplication[] = [];
  let maxAllowed = 100;

  const rejectedArticles = allRejected.filter((r) =>
    r.rejection_code === 'ARTICLE_AS_COMPANY' || r.entity_type === 'article' || r.entity_type === 'blog_post',
  ).length;

  const invalidPct = rawCount > 0 ? ((rawCount - tv) / rawCount) * 100 : 0;

  // Cap 1: Less than 8 verified companies
  if (tv < 5) {
    caps.push({ cap_name: 'verified_lt_5', cap_value: 40, reason: 'Less than 5 verified companies', metric_value: tv });
    maxAllowed = Math.min(maxAllowed, 40);
  } else if (tv < 8) {
    caps.push({ cap_name: 'verified_lt_8', cap_value: 60, reason: 'Less than 8 verified companies', metric_value: tv });
    maxAllowed = Math.min(maxAllowed, 60);
  }

  // Cap 2: More than 20% invalid identities
  if (invalidPct > 20) {
    caps.push({ cap_name: 'invalid_identity_pct', cap_value: 35, reason: `More than 20% invalid identities (${invalidPct.toFixed(0)}%)`, metric_value: `${invalidPct.toFixed(0)}%` });
    maxAllowed = Math.min(maxAllowed, 35);
  }

  // Cap 3: 0 LinkedIn and 0 verified cities
  if (verifiedCandidates.filter((c) => c.linkedin_status === 'found').length === 0 &&
    diversification.cities_distinct === 0) {
    caps.push({ cap_name: 'no_linkedin_no_cities', cap_value: 45, reason: '0 LinkedIn found and 0 verified cities', metric_value: '0 / 0' });
    maxAllowed = Math.min(maxAllowed, 45);
  }

  // Cap 4: Less than 8 official sites
  if (withOfficialSite < 8) {
    caps.push({ cap_name: 'official_sites_lt_8', cap_value: 70, reason: `Less than 8 official sites verified (${withOfficialSite})`, metric_value: withOfficialSite });
    maxAllowed = Math.min(maxAllowed, 70);
  }

  // Cap 5: Less than 8 strong/official evidence
  const strongOrOfficial = officialCount + strongCount;
  if (strongOrOfficial < 8) {
    caps.push({ cap_name: 'strong_evidence_lt_8', cap_value: 75, reason: `Less than 8 candidates with strong/official evidence (${strongOrOfficial})`, metric_value: strongOrOfficial });
    maxAllowed = Math.min(maxAllowed, 75);
  }

  // Cap 6 (hard): Article or publication in final results → benchmark invalid
  if (rejectedArticles > 0 && verifiedCandidates.some((c) => c.entity_type === 'article' || c.entity_type === 'blog_post')) {
    caps.push({ cap_name: 'article_in_final_results', cap_value: 0, reason: `Article or publication passed through to final results — benchmark invalid`, metric_value: 'INVALID' });
    maxAllowed = Math.min(maxAllowed, 0);
  }

  // ─── Caps nuevos 16AB.23.2 ─────────────────────────────────────────────────

  // Cap 7 (hard): Duplicado externo exacto en resultados finales → benchmark inválido, max 40
  const externalDupsInFinal = allRejected.filter(
    (r) => r.rejection_code === 'EXTERNAL_DUPLICATE',
  ).length;
  // Note: this cap triggers only if duplicates slipped through to final (rejection_code presence
  // means they were caught by the pipeline — here we check verifiedCandidates for any that
  // might have been marked duplicate_sellup or duplicate_hubspot in their _duplicate_status field)
  const dupSlippedThrough = verifiedCandidates.filter(
    (c) => (c as VerifiedBenchmarkCandidate & { _duplicate_status?: string })._duplicate_status === 'duplicate_sellup' ||
           (c as VerifiedBenchmarkCandidate & { _duplicate_status?: string })._duplicate_status === 'duplicate_hubspot',
  ).length;
  if (dupSlippedThrough > 0) {
    caps.push({ cap_name: 'external_duplicate_in_final', cap_value: 40, reason: `${dupSlippedThrough} duplicado(s) externo(s) exacto(s) en resultado final`, metric_value: dupSlippedThrough });
    maxAllowed = Math.min(maxAllowed, 40);
  }

  // Cap 8: Confianza Baja en resultado final → max 50
  const lowConfidenceInFinal = verifiedCandidates.filter((c) => c.confidence === 'Baja').length;
  if (lowConfidenceInFinal > 0) {
    caps.push({ cap_name: 'low_confidence_in_final', cap_value: 50, reason: `${lowConfidenceInFinal} candidato(s) de confianza Baja en resultado final`, metric_value: lowConfidenceInFinal });
    maxAllowed = Math.min(maxAllowed, 50);
  }

  // Cap 9: >20% de filas finales con evidencia Nivel C o D → max 70
  const weakEvidenceInFinal = allRejected.filter(
    (r) => r.rejection_code === 'WEAK_EVIDENCE_PRIMARY',
  ).length;
  const totalFinal = n + weakEvidenceInFinal; // approximate total before weak rejection
  const weakPct = totalFinal > 0 ? (weakEvidenceInFinal / totalFinal) * 100 : 0;
  if (weakPct > 20) {
    caps.push({ cap_name: 'weak_evidence_pct', cap_value: 70, reason: `Más del 20% de filas finales con evidencia débil (${weakPct.toFixed(0)}%)`, metric_value: `${weakPct.toFixed(0)}%` });
    maxAllowed = Math.min(maxAllowed, 70);
  }

  // Cap 10: URL secundaria repetida como evidencia principal de >1 empresa → max 75
  // Detected via pool_metrics.repeated_evidence_count (passed from selection pipeline)
  // Since computeHardenedScore doesn't receive pool metrics directly, we detect via rejected codes
  const repeatedEvidenceCount = allRejected.filter(
    (r) => r.rejection_code === 'REPEATED_EVIDENCE',
  ).length;
  if (repeatedEvidenceCount > 0) {
    caps.push({ cap_name: 'repeated_evidence', cap_value: 75, reason: `URL de evidencia repetida para ${repeatedEvidenceCount} empresa(s)`, metric_value: repeatedEvidenceCount });
    maxAllowed = Math.min(maxAllowed, 75);
  }

  // Cap 11: Externalduplicates detected (pipeline caught them — score penalty)
  if (externalDupsInFinal > 0) {
    caps.push({ cap_name: 'external_duplicates_detected', cap_value: 75, reason: `${externalDupsInFinal} duplicado(s) externo(s) detectados y eliminados del pool`, metric_value: externalDupsInFinal });
    maxAllowed = Math.min(maxAllowed, 75);
  }

  const finalScore = Math.min(rawScore, maxAllowed);

  return {
    score_before_caps: Math.min(100, rawScore),
    score_after_caps: Math.max(0, finalScore),
    breakdown: {
      veracidad_identidad: Math.min(25, veracidad),
      ajuste_pais_sector: Math.min(20, ajuste),
      calidad_evidencia: Math.min(20, evidencia),
      completitud: Math.min(15, completitud),
      novedad_sin_duplicados: Math.min(10, novedad),
      diversificacion: Math.min(10, diversificacion),
    },
    caps_applied: caps,
  };
}

// ─── Legacy score (kept for backward compat — uses BenchmarkCandidate) ────────
// Used by current-sellup provider before validation pipeline is applied.

export function computeScore(
  candidates: BenchmarkCandidate[],
  duplicatesFound: number,
  diversification: DiversificationMetrics,
): { score: number; breakdown: ScoreBreakdown } {
  const n = candidates.length;
  if (n === 0) return { score: 0, breakdown: { veracidad_identidad: 0, ajuste_pais_sector: 0, calidad_evidencia: 0, completitud: 0, novedad_sin_duplicados: 0, diversificacion: 0 } };

  const withWebsite = candidates.filter((c) => isOfficialSiteUrl(c.website)).length;
  const withEvidence = candidates.filter((c) => isValidUrl(c.evidence_url)).length;
  const veracidad = Math.round(((withWebsite / n) * 15 + (withEvidence / n) * 10));

  const coFit = candidates.filter((c) => {
    const country = (c.country ?? '').toLowerCase();
    return country.includes('colombia') || country.includes('co');
  }).length;
  const secFit = candidates.filter((c) => {
    const sector = (c.sector ?? '').toLowerCase();
    return sector.includes('tecnol') || sector.includes('tech') || sector.includes('software') || sector.includes('digital');
  }).length;
  const ajuste = Math.round(((coFit / n) * 10 + (secFit / n) * 10));

  const strengths = candidates.map((c) => evidenceStrength(c));
  const officialCount = strengths.filter((s) => s === 'official').length;
  const strongCount = strengths.filter((s) => s === 'strong').length;
  const weakCount = strengths.filter((s) => s === 'weak').length;
  const evidencia = Math.round(
    (officialCount / n) * 20 +
    (strongCount / n) * 12 +
    (weakCount / n) * 4,
  );

  const avgCompleteness = candidates.reduce((sum, c) => sum + candidateCompleteness(c), 0) / n;
  const completitud = Math.round(avgCompleteness * 15);
  const duplicatePenalty = Math.min(duplicatesFound * 2, 10);
  const novedad = Math.max(0, 10 - duplicatePenalty);
  const citiesScore = Math.min(diversification.cities_distinct * 2, 6);
  const subScore = Math.min(diversification.subsectors_distinct * 1.5, 4);
  const diversificacion = Math.round(citiesScore + subScore);
  const total = veracidad + ajuste + evidencia + completitud + novedad + diversificacion;

  return {
    score: Math.min(100, total),
    breakdown: {
      veracidad_identidad: veracidad,
      ajuste_pais_sector: ajuste,
      calidad_evidencia: Math.min(20, evidencia),
      completitud,
      novedad_sin_duplicados: novedad,
      diversificacion,
    },
  };
}

// ─── Métricas completas (hardened) ────────────────────────────────────────────

export function computeMetrics(
  result: ProviderRunResult,
  phaseResult?: CandidatePhaseResult,
  poolMetrics?: PoolMetrics,
): BenchmarkMetrics {
  const { candidates, duplicate_results, diversification, usage, timings } = result;
  const n = candidates.length;

  const uniqueDomains = new Set(
    candidates.map((c) => {
      try { return new URL(c.website ?? '').hostname; } catch { return c.name; }
    }),
  );

  const withWebsite = candidates.filter((c) => isOfficialSiteUrl(c.website)).length;
  const withLinkedin = candidates.filter((c) => isValidUrl(c.linkedin)).length;
  const withEvidence = candidates.filter((c) => isValidUrl(c.evidence_url)).length;
  const validUrls = candidates.filter(
    (c) => isValidUrl(c.website) || isValidUrl(c.evidence_url),
  ).length;

  const dupInternal = duplicate_results.filter((d) => d.status === 'duplicate_inside_result').length;
  const dupSellUp = duplicate_results.filter((d) => d.status === 'duplicate_sellup').length;
  const dupHubSpot = duplicate_results.filter((d) => d.status === 'duplicate_hubspot').length;

  const avgCompleteness = n === 0 ? 0 :
    candidates.reduce((sum, c) => sum + candidateCompleteness(c), 0) / n;

  const div = diversification ?? computeDiversification(candidates);
  const totalDuplicates = dupInternal + dupSellUp + dupHubSpot;

  // Use phase result for hardened metrics when available
  const verifiedCandidates = phaseResult?.verified_candidates ?? [];
  const rejectedCandidates = phaseResult?.rejected_candidates ?? [];
  const rawCount = phaseResult?.raw_discovered_candidates.length ?? n;

  let score: number;
  let breakdown: ScoreBreakdown;
  let scoreBefore: number;
  let scoreAfter: number;
  let capsApplied: CapApplication[] = [];

  if (verifiedCandidates.length > 0 || rejectedCandidates.length > 0) {
    const hardenedDiv = computeDiversification(verifiedCandidates.length > 0 ? verifiedCandidates : candidates);
    const hardenedResult = computeHardenedScore(
      verifiedCandidates,
      rejectedCandidates,
      rawCount,
      totalDuplicates,
      hardenedDiv,
    );
    score = hardenedResult.score_after_caps;
    breakdown = hardenedResult.breakdown;
    scoreBefore = hardenedResult.score_before_caps;
    scoreAfter = hardenedResult.score_after_caps;
    capsApplied = hardenedResult.caps_applied;
  } else {
    // Legacy path (no phase result available)
    const legacyResult = computeScore(candidates, totalDuplicates, div);
    score = legacyResult.score;
    breakdown = legacyResult.breakdown;
    scoreBefore = legacyResult.score;
    scoreAfter = legacyResult.score;
  }

  // Extended metrics
  const rejectedArticles = rejectedCandidates.filter((r) =>
    r.entity_type === 'article' || r.entity_type === 'blog_post' || r.rejection_code === 'ARTICLE_AS_COMPANY',
  ).length;
  const rejectedNonCompany = rejectedCandidates.filter((r) =>
    r.entity_type !== 'article' && r.entity_type !== 'blog_post',
  ).length;
  const identityAttempted = rejectedCandidates.filter((r) =>
    r.rejection_code === 'UNRESOLVABLE_IDENTITY' || r.rejection_code === 'ARTICLE_AS_COMPANY',
  ).length + verifiedCandidates.filter((c) => c.identity_resolution !== null).length;
  const identitySuccessful = verifiedCandidates.filter((c) => c.identity_resolution?.resolved_company_name).length;
  const officialDomainVerified = verifiedCandidates.filter((c) => isOfficialSiteUrl(c.official_website_url)).length;
  const linkedInFound = verifiedCandidates.filter((c) => c.linkedin_status === 'found').length;
  const linkedInSearchedNotFound = verifiedCandidates.filter((c) => c.linkedin_status === 'searched_not_found').length;
  const missingDescription = (verifiedCandidates.length > 0 ? verifiedCandidates : candidates).filter((c) => !c.description).length;
  const invalidFinalRows = phaseResult ? phaseResult.rejected_candidates.filter((r) => r.rejection_code === 'INVALID_FINAL_ROW').length : 0;
  const verifiedCompanyCount = verifiedCandidates.filter((c) => c.is_verified_company).length;

  const strengths = (verifiedCandidates.length > 0 ? verifiedCandidates : candidates).map(evidenceStrength);
  const officialCount = strengths.filter((s) => s === 'official').length;
  const strongCount = strengths.filter((s) => s === 'strong').length;
  const weakCount = strengths.filter((s) => s === 'weak').length;

  return {
    provider: result.provider,
    model: result.model,
    status: result.status,

    companies_returned: n,
    companies_unique: uniqueDomains.size,
    companies_with_website: withWebsite,
    companies_with_linkedin: withLinkedin,
    companies_with_evidence_url: withEvidence,
    urls_valid: validUrls,
    duplicate_internal: dupInternal,
    duplicate_sellup: dupSellUp,
    duplicate_hubspot: dupHubSpot,

    completeness_pct: Math.round(avgCompleteness * 100),

    pct_official_source: n === 0 ? 0 : Math.round((officialCount / n) * 100),
    pct_strong_evidence: n === 0 ? 0 : Math.round((strongCount / n) * 100),
    pct_weak_evidence: n === 0 ? 0 : Math.round((weakCount / n) * 100),

    cities_distinct: div.cities_distinct,
    subsectors_distinct: div.subsectors_distinct,
    max_city_concentration: div.max_concentration_city.count,

    duration_ms: timings.duration_ms,
    searches_executed: usage.searches_executed,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    estimated_cost_usd: usage.estimated_cost_usd,
    errors_count: result.errors.length,

    // Web search observability (16AB.23.5)
    web_search_requests_reported: usage.web_search_requests_reported ?? 0,
    web_search_requests_inferred: usage.web_search_requests_inferred ?? 0,
    web_search_count_status: usage.web_search_count_status ?? 'unavailable',
    web_search_results_count: usage.web_search_results_count ?? 0,
    web_search_citations_count: usage.web_search_citations_count ?? 0,
    web_search_errors_count: usage.web_search_errors_count ?? 0,
    unique_search_result_urls: 0,         // populated by run if audits are loaded
    unique_cited_urls: 0,                 // populated by run if audits are loaded
    model_generated_urls_count: 0,        // populated by run if audits are loaded
    auditable_candidates_count: 0,        // populated by run if audits are loaded
    partially_auditable_candidates_count: 0,
    not_auditable_candidates_count: n,    // conservative default — updated when audits available
    web_search_cost_usd: usage.web_search_cost_usd ?? null,

    score,
    score_breakdown: breakdown,

    // Extended (16AB.23.1)
    raw_discovered_count: rawCount,
    verified_company_count: verifiedCompanyCount,
    rejected_non_company_count: rejectedNonCompany,
    rejected_article_count: rejectedArticles,
    identity_resolution_attempted: identityAttempted,
    identity_resolution_successful: identitySuccessful,
    official_domain_verified_count: officialDomainVerified,
    linkedin_found_count: linkedInFound,
    linkedin_searched_not_found_count: linkedInSearchedNotFound,
    missing_description_count: missingDescription,
    invalid_final_rows: invalidFinalRows,
    score_before_caps: scoreBefore,
    score_after_caps: scoreAfter,
    caps_applied: capsApplied,
    automatically_verified_companies: verifiedCompanyCount,
    human_review_status: 'pending',
    pool_metrics: poolMetrics,
  };
}

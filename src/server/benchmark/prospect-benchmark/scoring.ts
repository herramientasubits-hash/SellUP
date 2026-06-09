/**
 * Prospect Generation Benchmark — Scoring & Métricas (Hito 16AB.23)
 *
 * Calcula el score técnico 0-100 y métricas automáticas por proveedor.
 * Sin llamadas externas. Completamente determinístico.
 */

import type {
  BenchmarkCandidate,
  BenchmarkMetrics,
  DiversificationMetrics,
  ProviderRunResult,
  ScoreBreakdown,
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

// ─── Completeness por candidato (14 campos del contrato) ─────────────────────

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

// ─── Fortaleza de evidencia ───────────────────────────────────────────────────

const STRONG_EVIDENCE_PATTERNS = [
  /linkedin\.com\/company\//i,
  /\.com\.co\//i,
  /camara.*comercio/i,
  /fedesoft/i,
  /rues/i,
  /superfinanciera/i,
];

const WEAK_EVIDENCE_PATTERNS = [
  /google\.com\/search/i,
  /wikipedia/i,
  /yellow.*pages/i,
  /paginas.*amarillas/i,
];

function evidenceStrength(c: BenchmarkCandidate): 'strong' | 'official' | 'weak' | 'none' {
  const urls = [c.evidence_url, c.website].filter(Boolean);
  if (!urls.length) return 'none';

  const allUrls = urls.join(' ');

  if (STRONG_EVIDENCE_PATTERNS.some((p) => p.test(allUrls))) return 'official';
  if (WEAK_EVIDENCE_PATTERNS.some((p) => p.test(allUrls))) return 'weak';
  if (isValidUrl(c.evidence_url)) return 'strong';
  return 'weak';
}

// ─── Diversificación ─────────────────────────────────────────────────────────

export function computeDiversification(
  candidates: BenchmarkCandidate[]
): DiversificationMetrics {
  const cityCount: Record<string, number> = {};
  const subsectorCount: Record<string, number> = {};
  const sizeCount: Record<string, number> = {};

  for (const c of candidates) {
    const city = (c.city ?? 'Desconocida').trim();
    cityCount[city] = (cityCount[city] ?? 0) + 1;

    const subsector = (c.sector ?? 'Tecnología').split('/')[0].trim();
    subsectorCount[subsector] = (subsectorCount[subsector] ?? 0) + 1;

    const size = c.estimated_size ?? 'No disponible';
    sizeCount[size] = (sizeCount[size] ?? 0) + 1;
  }

  const maxCity = Object.entries(cityCount).sort((a, b) => b[1] - a[1])[0] ?? ['?', 0];
  const maxSub = Object.entries(subsectorCount).sort((a, b) => b[1] - a[1])[0] ?? ['?', 0];

  return {
    cities_distinct: Object.keys(cityCount).length,
    subsectors_distinct: Object.keys(subsectorCount).length,
    max_concentration_city: { city: maxCity[0], count: maxCity[1] },
    max_concentration_subsector: { subsector: maxSub[0], count: maxSub[1] },
    size_distribution: sizeCount,
  };
}

// ─── Score 0-100 ──────────────────────────────────────────────────────────────

export function computeScore(
  candidates: BenchmarkCandidate[],
  duplicatesFound: number,
  diversification: DiversificationMetrics
): { score: number; breakdown: ScoreBreakdown } {
  const n = candidates.length;
  if (n === 0) return { score: 0, breakdown: { veracidad_identidad: 0, ajuste_pais_sector: 0, calidad_evidencia: 0, completitud: 0, novedad_sin_duplicados: 0, diversificacion: 0 } };

  // 25 pts — Veracidad e identidad
  const withWebsite = candidates.filter((c) => isValidUrl(c.website)).length;
  const withEvidence = candidates.filter((c) => isValidUrl(c.evidence_url)).length;
  const veracidad = Math.round(
    ((withWebsite / n) * 15 + (withEvidence / n) * 10)
  );

  // 20 pts — Ajuste Colombia / Tecnología
  const coFit = candidates.filter((c) => {
    const country = (c.country ?? '').toLowerCase();
    return country.includes('colombia') || country.includes('co');
  }).length;
  const secFit = candidates.filter((c) => {
    const sector = (c.sector ?? '').toLowerCase();
    return sector.includes('tecnol') || sector.includes('tech') || sector.includes('software') || sector.includes('digital');
  }).length;
  const ajuste = Math.round(((coFit / n) * 10 + (secFit / n) * 10));

  // 20 pts — Calidad de evidencia
  const strengths = candidates.map(evidenceStrength);
  const officialCount = strengths.filter((s) => s === 'official').length;
  const strongCount = strengths.filter((s) => s === 'strong').length;
  const weakCount = strengths.filter((s) => s === 'weak').length;
  const evidencia = Math.round(
    (officialCount / n) * 20 +
    (strongCount / n) * 12 +
    (weakCount / n) * 4
  );

  // 15 pts — Completitud
  const avgCompleteness = candidates.reduce((sum, c) => sum + candidateCompleteness(c), 0) / n;
  const completitud = Math.round(avgCompleteness * 15);

  // 10 pts — Novedad y ausencia de duplicados
  const duplicatePenalty = Math.min(duplicatesFound * 2, 10);
  const novedad = Math.max(0, 10 - duplicatePenalty);

  // 10 pts — Diversificación
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
      completitud: completitud,
      novedad_sin_duplicados: novedad,
      diversificacion: diversificacion,
    },
  };
}

// ─── Métricas completas ───────────────────────────────────────────────────────

export function computeMetrics(result: ProviderRunResult): BenchmarkMetrics {
  const { candidates, duplicate_results, diversification, usage, timings } = result;
  const n = candidates.length;

  const uniqueDomains = new Set(
    candidates.map((c) => {
      try { return new URL(c.website ?? '').hostname; } catch { return c.name; }
    })
  );

  const withWebsite = candidates.filter((c) => isValidUrl(c.website)).length;
  const withLinkedin = candidates.filter((c) => isValidUrl(c.linkedin)).length;
  const withEvidence = candidates.filter((c) => isValidUrl(c.evidence_url)).length;
  const validUrls = candidates.filter(
    (c) => isValidUrl(c.website) || isValidUrl(c.evidence_url)
  ).length;

  const dupInternal = duplicate_results.filter((d) => d.status === 'duplicate_inside_result').length;
  const dupSellUp = duplicate_results.filter((d) => d.status === 'duplicate_sellup').length;
  const dupHubSpot = duplicate_results.filter((d) => d.status === 'duplicate_hubspot').length;

  const avgCompleteness = n === 0 ? 0 :
    candidates.reduce((sum, c) => sum + candidateCompleteness(c), 0) / n;

  const strengths = candidates.map(evidenceStrength);
  const officialCount = strengths.filter((s) => s === 'official').length;
  const strongCount = strengths.filter((s) => s === 'strong').length;
  const weakCount = strengths.filter((s) => s === 'weak').length;

  const div = diversification ?? computeDiversification(candidates);
  const totalDuplicates = dupInternal + dupSellUp + dupHubSpot;
  const { score, breakdown } = computeScore(candidates, totalDuplicates, div);

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

    score,
    score_breakdown: breakdown,
  };
}

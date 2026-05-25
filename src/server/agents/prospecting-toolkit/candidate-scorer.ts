/**
 * Prospecting Toolkit — Candidate Scorer (Hito 3C)
 *
 * Consolida señales de tools existentes y calcula tres scores:
 *   - confidenceScore   : qué tan confiable es que la empresa existe y los datos son correctos
 *   - fitScore          : relevancia comercial para UBITS
 *   - dataCompletenessScore : completitud operativa del registro
 *
 * Reglas críticas:
 * - Determinística: misma entrada → mismo resultado.
 * - No hace fetch, no llama APIs, no depende de estado externo.
 * - No llama Apollo, Lusha ni HubSpot.
 * - No usa proveedor IA.
 * - Si HubSpot no pudo verificarse (status "unchecked"), nunca aprueba como nuevo.
 */

import type {
  CandidateScoringInput,
  CandidateScoringOutput,
  CandidateQualityLabel,
  CandidateRecommendedAction,
  CandidateScoreBreakdown,
} from './types';

// ─── Constantes de scoring ────────────────────────────────────────────────────

const LARGE_COMPANY_SIZES = new Set([
  'grande', 'large', 'enterprise', 'corporacion', 'corporación',
  'multinacional', 'multinational', 'enterprise+', 'grande+',
]);

const MEDIUM_COMPANY_SIZES = new Set([
  'mediana', 'medium', 'mediana empresa', 'mid-size', 'midsize', 'mid',
  'pyme mediana', 'sme',
]);

// Palabras que señalan buyer L&D / RRHH en reasonForFit
const BUYER_SIGNAL_TERMS = [
  'rrhh', 'recursos humanos', 'human resources', 'hr ', 'learning',
  'capacitacion', 'capacitación', 'formacion', 'formación', 'desarrollo',
  'talento', 'talent', 'l&d', 'e-learning', 'elearning', 'training',
  'educacion corporativa', 'educación corporativa', 'upskilling', 'reskilling',
];

// Industrias genéricas/débiles que reciben penalización de fit
const WEAK_INDUSTRIES = new Set([
  'other', 'otros', 'otro', 'general', 'varios', 'diverse',
  'diversificado', 'miscelanea', 'miscelánea',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hasUsefulName(name: string | null | undefined): boolean {
  return !!name && name.trim().length >= 2;
}

function hasBuyerSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return BUYER_SIGNAL_TERMS.some((term) => lower.includes(term));
}

function industryMatchesCatalog(
  industry: string | null | undefined,
  catalogIndustry: string | null | undefined,
): boolean {
  if (!industry || !catalogIndustry) return false;
  const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const a = normalize(industry);
  const b = normalize(catalogIndustry);
  return a === b || a.includes(b) || b.includes(a);
}

// ─── Confidence Score ─────────────────────────────────────────────────────────

type ConfidenceResult = {
  score: number;
  signals: number;
  penalties: number;
  reasons: string[];
  warnings: string[];
  blockers: string[];
};

function computeConfidenceScore(input: CandidateScoringInput): ConfidenceResult {
  let raw = 0;
  let penalties = 0;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  // Nombre útil: +15
  if (hasUsefulName(input.name)) {
    raw += 15;
  } else {
    blockers.push('Nombre de empresa ausente o inválido.');
  }

  // País o código de país: +10
  if (input.country || input.countryCode) {
    raw += 10;
    reasons.push('País identificado.');
  }

  // Website verification
  const wv = input.websiteVerification;
  if (wv && !wv.skipped) {
    if (wv.status === 'verified') {
      raw += 25;
      reasons.push('Website verificado contra dominio oficial.');
    } else if (wv.status === 'inferred') {
      raw += 10;
      warnings.push('Website inferido, requiere validación humana.');
    } else if (wv.status === 'mismatch') {
      penalties += 25;
      blockers.push('Website corresponde a otra empresa (mismatch).');
    } else if (wv.status === 'not_found' || wv.status === 'error') {
      penalties += 10;
      warnings.push('Website no encontrado o con error al verificar.');
    }
  } else if (input.website || input.domain) {
    // Website presente pero no verificado: señal débil positiva
    raw += 5;
    warnings.push('Website presente pero no verificado.');
  }

  // Duplicate check
  const dc = input.duplicateCheck;
  if (dc) {
    if (dc.status === 'new_candidate') {
      raw += 15;
      reasons.push('No se encontraron duplicados en SellUp/HubSpot.');
    } else if (dc.status === 'existing_in_hubspot' || dc.status === 'existing_in_sellup') {
      // No penaliza la existencia pero marca como blocker de label
      reasons.push('Empresa ya registrada en sistema.');
    } else if (dc.status === 'unchecked') {
      // HubSpot no pudo verificarse — regla crítica: no aprobar como nuevo
      warnings.push('HubSpot no pudo verificarse; no marcar como prospecto nuevo.');
      blockers.push('Verificación HubSpot incompleta (unchecked). No se puede confirmar como nueva empresa.');
    } else if (dc.status === 'error') {
      warnings.push('Error en verificación de duplicados. Revisar manualmente.');
    } else if (dc.status === 'insufficient_data') {
      blockers.push('Datos insuficientes para deduplicación.');
    } else if (dc.status === 'possible_duplicate') {
      warnings.push('Posible duplicado detectado. Requiere revisión.');
      blockers.push('Posible duplicado: no puede aprobarse como nueva empresa sin revisión humana.');
    }
  }

  // Fuente P0/P1: +10/+5
  if (input.sourcePriority === 'P0') {
    raw += 10;
    reasons.push('Fuente P0 de alta confianza.');
  } else if (input.sourcePriority === 'P1') {
    raw += 5;
    reasons.push('Fuente P1 compatible con país/sector.');
  }

  // Tax identifier presente: +10
  if (input.taxIdentifier?.trim()) {
    raw += 10;
    reasons.push('Identificador fiscal presente.');
  }

  // LinkedIn URL presente: +5
  if (input.linkedinCompanyUrl?.trim()) {
    raw += 5;
  } else {
    warnings.push('LinkedIn no disponible.');
  }

  const score = clamp(raw - penalties, 0, 100);
  return { score, signals: raw, penalties, reasons, warnings, blockers };
}

// ─── Fit Score ────────────────────────────────────────────────────────────────

type FitResult = {
  score: number;
  reasons: string[];
  warnings: string[];
};

function computeFitScore(input: CandidateScoringInput): FitResult {
  let raw = 0;
  let fitPenalties = 0;
  const reasons: string[] = [];
  const warnings: string[] = [];

  // Industria presente: +20
  if (input.industry?.trim()) {
    if (WEAK_INDUSTRIES.has(input.industry.trim().toLowerCase())) {
      fitPenalties += 10;
      warnings.push('Industria genérica detectada; fit débil.');
    } else {
      raw += 20;
    }
  } else {
    warnings.push('Industria no especificada.');
  }

  // Subsector presente: +10
  if (input.subsector?.trim()) {
    raw += 10;
  }

  // Razón de fit presente: +10
  if (input.reasonForFit?.trim()) {
    raw += 10;
    // Buyer/HR/L&D signal: +10 adicional
    if (hasBuyerSignal(input.reasonForFit)) {
      raw += 10;
      reasons.push('Señal buyer/HR/L&D detectada en justificación de fit.');
    }
  }

  // Company size
  const sizeLower = input.companySize?.toLowerCase().trim() ?? '';
  if (LARGE_COMPANY_SIZES.has(sizeLower)) {
    raw += 20;
    reasons.push('Empresa grande/enterprise: alto potencial de contrato.');
  } else if (MEDIUM_COMPANY_SIZES.has(sizeLower)) {
    raw += 20;
    reasons.push('Empresa mediana: perfil objetivo UBITS.');
  } else if (sizeLower) {
    raw += 5;
  }

  // Sector coincide con catalogContext.industry: +15
  if (
    input.catalogContext &&
    industryMatchesCatalog(input.industry, input.catalogContext.industry)
  ) {
    raw += 15;
    reasons.push('Sector coincide con contexto de catálogo para el país.');
  }

  // Source P0/P1: +5
  if (input.sourcePriority === 'P0' || input.sourcePriority === 'P1') {
    raw += 5;
  }

  const score = clamp(raw - fitPenalties, 0, 100);
  return { score, reasons, warnings };
}

// ─── Data Completeness Score ──────────────────────────────────────────────────

function computeCompletenessScore(input: CandidateScoringInput): number {
  let score = 0;

  if (hasUsefulName(input.name)) score += 15;
  if (input.country || input.countryCode) score += 10;
  if (input.industry?.trim()) score += 10;
  if (input.website?.trim() || input.domain?.trim()) score += 15;
  if (input.websiteVerification && !input.websiteVerification.skipped &&
    (input.websiteVerification.status === 'verified' || input.websiteVerification.status === 'inferred')) {
    score += 10;
  }
  if (input.city?.trim() || input.region?.trim()) score += 10;
  if (input.companySize?.trim()) score += 10;
  if (input.taxIdentifier?.trim()) score += 10;
  if (input.linkedinCompanyUrl?.trim()) score += 5;
  if (input.duplicateCheck) score += 5;

  return clamp(score, 0, 100);
}

// ─── Clasificación: label y acción ───────────────────────────────────────────

type LabelResult = {
  qualityLabel: CandidateQualityLabel;
  recommendedAction: CandidateRecommendedAction;
  blockers: string[];
};

function classifyLabelAndAction(
  input: CandidateScoringInput,
  confidenceScore: number,
  fitScore: number,
  dataCompletenessScore: number,
  blockers: string[],
): LabelResult {
  const dc = input.duplicateCheck;
  const wv = input.websiteVerification;
  const localBlockers = [...blockers];

  // ── Duplicado confirmado ───────────────────────────────────
  if (
    dc?.status === 'existing_in_hubspot' ||
    dc?.status === 'existing_in_sellup'
  ) {
    const source = dc.status === 'existing_in_sellup' ? 'SellUp' : 'HubSpot';
    localBlockers.push(`Empresa ya existe en ${source}.`);
    return {
      qualityLabel: 'duplicate',
      recommendedAction: 'exclude_existing',
      blockers: localBlockers,
    };
  }

  // ── Posible duplicado — evaluado antes que cualquier path a high_quality_new ──
  if (dc?.status === 'possible_duplicate') {
    localBlockers.push('Posible duplicado: requiere validación antes de aprobar.');
    return {
      qualityLabel: 'needs_review',
      recommendedAction: 'review_manually',
      blockers: localBlockers,
    };
  }

  // ── HubSpot unchecked — no aprobar como nuevo sin verificación (regla crítica) ──
  if (dc?.status === 'unchecked') {
    return {
      qualityLabel: 'needs_review',
      recommendedAction: 'review_manually',
      blockers: localBlockers,
    };
  }

  // ── Datos insuficientes ────────────────────────────────────
  const hasName = hasUsefulName(input.name);
  const hasWebOrDomain = !!(input.website?.trim() || input.domain?.trim());
  const dedupInsufficient = dc?.status === 'insufficient_data';

  if (!hasName || dedupInsufficient || (!hasName && !hasWebOrDomain)) {
    return {
      qualityLabel: 'insufficient_data',
      recommendedAction: 'enrich_before_review',
      blockers: localBlockers,
    };
  }

  // ── Descarte por website mismatch fuerte ───────────────────
  if (wv && !wv.skipped && wv.status === 'mismatch') {
    if (wv.confidence < 30 || (confidenceScore < 45 && fitScore < 45)) {
      return {
        qualityLabel: 'discard',
        recommendedAction: 'discard',
        blockers: localBlockers,
      };
    }
    // Mismatch pero datos razonables → needs_review
    return {
      qualityLabel: 'needs_review',
      recommendedAction: 'review_manually',
      blockers: localBlockers,
    };
  }

  // ── Discard por scores muy bajos ───────────────────────────
  if (confidenceScore < 40 && fitScore < 40) {
    return {
      qualityLabel: 'discard',
      recommendedAction: 'discard',
      blockers: localBlockers,
    };
  }

  // ── High quality new ───────────────────────────────────────
  if (
    dc?.status === 'new_candidate' &&
    confidenceScore >= 75 &&
    fitScore >= 70 &&
    dataCompletenessScore >= 65 &&
    wv?.status !== 'mismatch' &&
    localBlockers.length === 0
  ) {
    return {
      qualityLabel: 'high_quality_new',
      recommendedAction: 'approve_for_review',
      blockers: localBlockers,
    };
  }

  // ── Needs review (nuevo pero señales incompletas) ──────────
  return {
    qualityLabel: 'needs_review',
    recommendedAction: 'review_manually',
    blockers: localBlockers,
  };
}

// ─── Función pública ──────────────────────────────────────────────────────────

/**
 * Calcula scores de confianza, fit y completitud de datos para una empresa candidata.
 *
 * Determinística: no hace fetch, no llama APIs, no depende de estado externo.
 * Consume únicamente los outputs de tools ya existentes en el toolkit.
 */
export function scoreCandidate(input: CandidateScoringInput): CandidateScoringOutput {
  const confidence = computeConfidenceScore(input);
  const fit = computeFitScore(input);
  const dataCompletenessScore = computeCompletenessScore(input);

  const confidenceScore = confidence.score;
  const fitScore = fit.score;

  // Consolidar blockers de todas las fuentes
  const allBlockers = [...confidence.blockers];

  const { qualityLabel, recommendedAction, blockers: labelBlockers } =
    classifyLabelAndAction(input, confidenceScore, fitScore, dataCompletenessScore, allBlockers);

  const reasons = [
    ...confidence.reasons,
    ...fit.reasons,
  ];

  const warnings = [
    ...confidence.warnings,
    ...fit.warnings,
  ];

  const breakdown: CandidateScoreBreakdown = {
    existenceSignals: confidence.signals,
    websiteSignals: (() => {
      const wv = input.websiteVerification;
      if (!wv || wv.skipped) return 0;
      if (wv.status === 'verified') return 25;
      if (wv.status === 'inferred') return 10;
      return 0;
    })(),
    duplicateSignals: input.duplicateCheck?.status === 'new_candidate' ? 15 : 0,
    sourceSignals: input.sourcePriority === 'P0' ? 10 : input.sourcePriority === 'P1' ? 5 : 0,
    fitSignals: fitScore,
    completenessSignals: dataCompletenessScore,
    penalties: confidence.penalties,
  };

  return {
    confidenceScore,
    fitScore,
    dataCompletenessScore,
    qualityLabel,
    recommendedAction,
    breakdown,
    reasons,
    warnings,
    blockers: labelBlockers,
    metadata: {
      name: input.name,
      duplicateStatus: input.duplicateCheck?.status ?? null,
      websiteStatus: input.websiteVerification?.status ?? null,
      sourcePriority: input.sourcePriority ?? null,
    },
  };
}

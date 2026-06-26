// Agente 2A — Contact Relevance & Quality Classifier
// Hito 17A.3B — Clasifica un contacto normalizado por relevancia comercial
// (HR / People / Talento / Learning / Cultura / Bienestar / sponsor ejecutivo)
// y por calidad mínima de datos, para decidir si es revisable antes de
// insertarlo como pending_review.
//
// Reglas:
//  - Función PURA: sin red, sin DB, sin LLM. Segura para tests unitarios.
//  - Solo señales léxicas deterministas sobre cargo (title/headline).
//  - La calidad mínima (nombre completo, cargo, canal de contacto) puede
//    degradar a `insufficient_data` aunque el cargo sea relevante.
//  - Solo `high_relevance` y `medium_relevance` con calidad suficiente son
//    insertables (`shouldInsertForReview = true`).

import type { NormalizedApolloContact } from './contact-normalizer';

// ── Tipos públicos ─────────────────────────────────────────────

export type ContactRelevanceStatus =
  | 'high_relevance'
  | 'medium_relevance'
  | 'low_relevance'
  | 'not_relevant'
  | 'insufficient_data';

export type ContactRelevanceCategory =
  | 'hr'
  | 'people'
  | 'talent'
  | 'learning'
  | 'culture'
  | 'wellbeing'
  | 'executive_sponsor';

/** Categorías que cuentan como alta relevancia (HR/People/Learning core). */
type HighRelevanceCategory = Exclude<ContactRelevanceCategory, 'executive_sponsor'>;

export interface ContactRelevanceInput {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  headline?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  phone?: string | null;
  seniority?: string | null;
}

export interface ContactRelevanceResult {
  relevanceStatus: ContactRelevanceStatus;
  relevanceScore: number;
  qualityScore: number;
  shouldInsertForReview: boolean;
  rejectionReasons: string[];
  matchedKeywords: string[];
  matchedCategory: ContactRelevanceCategory | null;
}

// ── Vocabulario léxico (ES + EN) ───────────────────────────────

/**
 * Alta relevancia: señales claras de RR. HH. / People / Talento / Learning /
 * Cultura / Bienestar. El orden del Record define la prioridad de categoría
 * cuando una sola cadena dispara varias.
 */
export const HIGH_RELEVANCE_KEYWORDS: Record<HighRelevanceCategory, string[]> = {
  hr: [
    'recursos humanos',
    'human resources',
    'gestion humana',
    'capital humano',
    'rrhh',
    'hr',
    'chro',
    'hrbp',
    'hr business partner',
  ],
  people: [
    'people',
    'people officer',
    'people operations',
    'people manager',
    'chief people',
  ],
  talent: [
    'talento humano',
    'talent acquisition',
    'adquisicion de talento',
    'talento',
    'talent',
  ],
  learning: [
    'learning and development',
    'learning & development',
    'learning',
    'l&d',
    'formacion',
    'capacitacion',
    'training',
    'universidad corporativa',
    'desarrollo organizacional',
    'organizational development',
  ],
  culture: ['cultura', 'culture'],
  wellbeing: [
    'bienestar',
    'wellbeing',
    'well-being',
    'employee experience',
    'experiencia del empleado',
  ],
};

/** Orden de prioridad de categorías de alta relevancia. */
const HIGH_CATEGORY_ORDER: HighRelevanceCategory[] = [
  'hr',
  'people',
  'talent',
  'learning',
  'culture',
  'wellbeing',
];

/**
 * Media relevancia: posibles sponsors ejecutivos del proyecto, no HR directo.
 */
export const MEDIUM_RELEVANCE_KEYWORDS: string[] = [
  'transformacion digital',
  'transformacion',
  'innovacion',
  'sostenibilidad',
  'estrategia',
  'chief executive',
  'chief operating officer',
  'ceo',
  'coo',
  'gerente general',
  'director general',
  'presidente',
  'vicepresidente corporativo',
  'vp corporativo',
];

/**
 * Señales de baja o nula relevancia para SellUp (áreas no relacionadas con
 * la decisión de formación / desarrollo de personas).
 */
export const NEGATIVE_KEYWORDS: string[] = [
  'auditoria',
  'ciberseguridad',
  'seguridad informatica',
  'software engineer',
  'developer',
  'desarrollador',
  'credito',
  'riesgos',
  'financial advisor',
  'asesor financiero',
  'ventas de zona',
  'branch manager',
  'legal',
  'contabilidad',
  'tesoreria',
  'operaciones bancarias',
  'producto financiero',
  'cartera',
  'cumplimiento',
  'compliance',
  'erm',
];

// ── Scores base por estado de relevancia ───────────────────────

const RELEVANCE_BASE_SCORE: Record<ContactRelevanceStatus, number> = {
  high_relevance: 0.85,
  medium_relevance: 0.55,
  low_relevance: 0.3,
  not_relevant: 0.1,
  insufficient_data: 0,
};

// ── Motivos de rechazo (constantes legibles) ───────────────────

export const REJECTION_REASONS = {
  MISSING_NAME: 'Falta nombre utilizable',
  INCOMPLETE_NAME_NO_CHANNEL: 'Nombre incompleto sin canal de contacto',
  MISSING_TITLE: 'Sin cargo (title) para clasificar',
  NOT_HR_ROLE: 'Cargo no relacionado con HR/People/Learning',
} as const;

// ── Normalización léxica ───────────────────────────────────────

function normalizeText(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match con frontera alfanumérica: evita que 'hr' machee 'through' o que
 'l&d' falle por el '&'. Usa lookarounds en vez de \b (que no respeta '&').
 */
function matchesKeyword(haystack: string, keyword: string): boolean {
  const kw = normalizeText(keyword);
  if (!kw) return false;
  const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(kw)}(?![a-z0-9])`);
  return pattern.test(haystack);
}

function collectMatches(haystack: string, keywords: string[]): string[] {
  return keywords.filter((kw) => matchesKeyword(haystack, kw));
}

// ── Calidad mínima ─────────────────────────────────────────────

interface QualitySignals {
  hasFullName: boolean;
  isCompleteName: boolean;
  hasTitle: boolean;
  hasChannel: boolean;
  qualityScore: number;
}

function nameTokens(fullName: string | null | undefined): string[] {
  return (fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function computeQuality(input: ContactRelevanceInput): QualitySignals {
  const tokens = nameTokens(input.fullName);
  const hasFullName = tokens.length > 0;
  const isCompleteName = tokens.length >= 2;
  // Apollo a veces solo trae headline: lo aceptamos como cargo efectivo.
  const hasTitle = !!(input.title?.trim() || input.headline?.trim());
  const hasChannel = !!(input.email?.trim() || input.linkedinUrl?.trim() || input.phone?.trim());

  let score = 0;
  if (isCompleteName) score += 0.4;
  else if (hasFullName) score += 0.1;
  if (input.email?.trim()) score += 0.2;
  if (input.linkedinUrl?.trim()) score += 0.15;
  if (input.phone?.trim()) score += 0.1;
  if (hasTitle) score += 0.15;

  return {
    hasFullName,
    isCompleteName,
    hasTitle,
    hasChannel,
    qualityScore: Math.min(1, Number(score.toFixed(2))),
  };
}

/** Reglas del hito: cuándo los datos son insuficientes para revisión. */
function collectQualityRejections(q: QualitySignals): string[] {
  const reasons: string[] = [];
  if (!q.hasFullName) reasons.push(REJECTION_REASONS.MISSING_NAME);
  if (!q.isCompleteName && !q.hasChannel) {
    reasons.push(REJECTION_REASONS.INCOMPLETE_NAME_NO_CHANNEL);
  }
  if (!q.hasTitle) reasons.push(REJECTION_REASONS.MISSING_TITLE);
  return reasons;
}

// ── Clasificación de relevancia por cargo ──────────────────────

interface RoleClassification {
  status: Exclude<ContactRelevanceStatus, 'insufficient_data'>;
  category: ContactRelevanceCategory | null;
  matchedKeywords: string[];
}

function classifyRole(haystack: string): RoleClassification {
  // 1. Alta relevancia (HR/People/Talent/Learning/Culture/Wellbeing).
  const highMatches: string[] = [];
  let highCategory: ContactRelevanceCategory | null = null;
  for (const category of HIGH_CATEGORY_ORDER) {
    const matches = collectMatches(haystack, HIGH_RELEVANCE_KEYWORDS[category]);
    if (matches.length > 0) {
      if (!highCategory) highCategory = category;
      highMatches.push(...matches);
    }
  }
  if (highCategory) {
    return { status: 'high_relevance', category: highCategory, matchedKeywords: highMatches };
  }

  // 2. Media relevancia (sponsor ejecutivo / transformación / innovación).
  const mediumMatches = collectMatches(haystack, MEDIUM_RELEVANCE_KEYWORDS);
  if (mediumMatches.length > 0) {
    return {
      status: 'medium_relevance',
      category: 'executive_sponsor',
      matchedKeywords: mediumMatches,
    };
  }

  // 3. Señal negativa explícita → no relevante.
  const negativeMatches = collectMatches(haystack, NEGATIVE_KEYWORDS);
  if (negativeMatches.length > 0) {
    return { status: 'not_relevant', category: null, matchedKeywords: negativeMatches };
  }

  // 4. Sin señal: baja relevancia (cargo desconocido / no objetivo).
  return { status: 'low_relevance', category: null, matchedKeywords: [] };
}

// ── API principal ──────────────────────────────────────────────

/**
 * Clasifica un contacto por relevancia comercial y calidad de datos.
 * La insuficiencia de datos tiene prioridad sobre la relevancia del cargo:
 * un cargo perfecto sin nombre completo ni canal NO es revisable.
 */
export function classifyContactRelevance(input: ContactRelevanceInput): ContactRelevanceResult {
  const haystack = normalizeText(`${input.title ?? ''} ${input.headline ?? ''}`);
  const role = classifyRole(haystack);
  const quality = computeQuality(input);
  const qualityRejections = collectQualityRejections(quality);

  // Calidad insuficiente → terminal, no insertable (independiente del cargo).
  if (qualityRejections.length > 0) {
    return {
      relevanceStatus: 'insufficient_data',
      relevanceScore: RELEVANCE_BASE_SCORE[role.status],
      qualityScore: quality.qualityScore,
      shouldInsertForReview: false,
      rejectionReasons: qualityRejections,
      matchedKeywords: role.matchedKeywords,
      matchedCategory: role.category,
    };
  }

  const shouldInsert =
    role.status === 'high_relevance' || role.status === 'medium_relevance';

  const rejectionReasons = shouldInsert ? [] : [REJECTION_REASONS.NOT_HR_ROLE];

  return {
    relevanceStatus: role.status,
    relevanceScore: RELEVANCE_BASE_SCORE[role.status],
    qualityScore: quality.qualityScore,
    shouldInsertForReview: shouldInsert,
    rejectionReasons,
    matchedKeywords: role.matchedKeywords,
    matchedCategory: role.category,
  };
}

/** Adaptador desde el contacto ya normalizado del toolkit. */
export function classifyNormalizedContact(
  contact: NormalizedApolloContact,
): ContactRelevanceResult {
  const headline =
    typeof contact.enrichmentMetadata?.headline === 'string'
      ? (contact.enrichmentMetadata.headline as string)
      : null;
  return classifyContactRelevance({
    fullName: contact.fullName,
    firstName: contact.firstName,
    lastName: contact.lastName,
    title: contact.title,
    headline,
    email: contact.email,
    linkedinUrl: contact.linkedinUrl,
    phone: contact.phone,
    seniority: contact.seniority,
  });
}

/** Conveniencia: ¿este contacto debe pasar a revisión? */
export function isReviewableContact(result: ContactRelevanceResult): boolean {
  return result.shouldInsertForReview;
}

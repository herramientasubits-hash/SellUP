/**
 * Planes de créditos (LMS AI y Selección) y el recomendador de plan.
 *
 * Los dos productos se venden por plan anual de créditos (Basic, Pro, Max) más
 * paquetes adicionales. El recomendador estima el consumo del cliente y propone
 * el plan más barato que lo cubre.
 */

export const CREDIT_TIERS = ['basic', 'pro', 'max'] as const;
export type CreditTier = (typeof CREDIT_TIERS)[number];

export const CREDIT_TIER_PLANS: Record<CreditTier, { label: string; credits: number; list: number }> = {
  basic: { label: 'Basic', credits: 100_000, list: 4_000 },
  pro: { label: 'Pro', credits: 300_000, list: 10_000 },
  max: { label: 'Max', credits: 500_000, list: 16_000 },
};

/** Paquete adicional de créditos: tamaño, precio de lista y tope por cotización. */
export interface CreditPack {
  credits: number;
  list: number;
  maxPacks: number;
}

/** Versión 2027: paquetes de 50K. */
export const CREDIT_PACK_2027: CreditPack = { credits: 50_000, list: 2_000, maxPacks: 20 };
/** Versión 2026: paquetes de 100K. */
export const CREDIT_PACK_2026: CreditPack = { credits: 100_000, list: 4_000, maxPacks: 20 };

/** Lo que el vendedor elige para un producto de créditos. */
export interface CreditSelection {
  tier: CreditTier | null;
  packs: number;
}

export const NO_CREDITS: CreditSelection = { tier: null, packs: 0 };

/** Paquetes válidos: entero, sin negativos y con tope. */
export function clampPacks(packs: number, pack: CreditPack): number {
  return Math.min(Math.max(0, Math.floor(packs)), pack.maxPacks);
}

// ── Cuánto alcanza ──────────────────────────────────────────────────────────

/** Hasta 85 % del plan alcanza; hasta 100 % queda justo; más, no alcanza. */
const FIT_THRESHOLDS = { fits: 0.85, tight: 1 };

export type CreditFit = 'fits' | 'tight' | 'short';

export const CREDIT_FIT_LABELS: Record<CreditFit, string> = {
  fits: 'Alcanza',
  tight: 'Justo',
  short: 'No alcanza',
};

export function creditFit(ratio: number): CreditFit {
  if (ratio <= FIT_THRESHOLDS.fits) return 'fits';
  if (ratio <= FIT_THRESHOLDS.tight) return 'tight';
  return 'short';
}

export interface CreditTierOption {
  tier: CreditTier;
  price: number;
  credits: number;
  ratio: number;
  fit: CreditFit;
  /** Paquetes adicionales que harían falta para cubrir el consumo. */
  packs: number;
  totalCost: number;
  /** Créditos que sobran con plan + paquetes. */
  slack: number;
}

/** Cada plan con los paquetes que necesitaría para cubrir `used` créditos al año. */
export function creditTierOptions(used: number, pack: CreditPack): CreditTierOption[] {
  return CREDIT_TIERS.map((tier) => {
    const plan = CREDIT_TIER_PLANS[tier];
    const packs = Math.max(0, Math.ceil((used - plan.credits) / pack.credits));
    const capacity = plan.credits + packs * pack.credits;
    return {
      tier,
      price: plan.list,
      credits: plan.credits,
      ratio: used / plan.credits,
      fit: creditFit(used / plan.credits),
      packs,
      totalCost: plan.list + packs * pack.list,
      slack: capacity - used,
    };
  });
}

/** El plan más barato que cubre el consumo (a igual costo, el que deja más holgura). */
export function recommendCreditTier(used: number, pack: CreditPack): CreditTierOption | null {
  if (used <= 0) return null;
  return [...creditTierOptions(used, pack)].sort(
    (a, b) => a.totalCost - b.totalCost || b.slack - a.slack,
  )[0];
}

// ── LMS AI: consumo por uso ─────────────────────────────────────────────────

export type LmsAiUsageSetId = 'artefacto' | 'unificado';

interface UsageRow {
  id: string;
  group: string;
  name: string;
  credits: number;
  /** Cantidad al año con que arranca el estimado. */
  base: number;
}

interface UsageSet {
  id: LmsAiUsageSetId;
  label: string;
  /** Lo que consume un curso completo. */
  course: { rows: string[]; credits: number };
  rows: UsageRow[];
}

export const LMS_AI_USAGE_SETS: Record<LmsAiUsageSetId, UsageSet> = {
  artefacto: {
    id: 'artefacto',
    label: 'Artefacto',
    course: { rows: ['portada', 'avatar', 'guion', 'evaluacion'], credits: 530 },
    rows: [
      { id: 'portada', group: 'Agentes', name: 'Generador de imágenes (portada)', credits: 50, base: 20 },
      { id: 'avatar', group: 'Agentes', name: 'Video avatar 2 min', credits: 320, base: 20 },
      { id: 'guion', group: 'Agentes', name: 'Agente de diálogos (guion)', credits: 80, base: 20 },
      { id: 'evaluacion', group: 'Agentes', name: 'Generador de evaluaciones', credits: 80, base: 20 },
      { id: 'roleplay', group: 'Agentes', name: 'Role play evaluativo (por intento)', credits: 150, base: 0 },
      { id: 'reg-portada', group: 'Agentes', name: 'Regenerar portada', credits: 50, base: 10 },
      { id: 'esc-1-3', group: 'Video por escena', name: 'Video por escena 1 a 3 min', credits: 650, base: 10 },
      { id: 'esc-3-5', group: 'Video por escena', name: 'Video por escena 3 a 5 min', credits: 750, base: 6 },
      { id: 'esc-5-10', group: 'Video por escena', name: 'Video por escena 5 a 10 min', credits: 1050, base: 4 },
      { id: 'esc-10-15', group: 'Video por escena', name: 'Video por escena 10 a 15 min', credits: 1350, base: 2 },
      { id: 'reg-imagen', group: 'Regeneraciones', name: 'Regenerar imagen (escena)', credits: 10, base: 30 },
      { id: 'reg-canvas', group: 'Regeneraciones', name: 'Regenerar canvas (escena)', credits: 15, base: 20 },
      { id: 'reg-avatar', group: 'Regeneraciones', name: 'Regenerar avatar (escena)', credits: 120, base: 8 },
    ],
  },
  unificado: {
    id: 'unificado',
    label: 'Unificados',
    course: { rows: ['portada', 'avatar', 'guion', 'evaluacion'], credits: 1210 },
    rows: [
      { id: 'portada', group: 'Agentes', name: 'Generador de imágenes (portada)', credits: 50, base: 20 },
      { id: 'avatar', group: 'Agentes', name: 'Video avatar 2 min', credits: 1000, base: 20 },
      { id: 'guion', group: 'Agentes', name: 'Agente de diálogos (guion)', credits: 80, base: 20 },
      { id: 'evaluacion', group: 'Agentes', name: 'Generador de evaluaciones', credits: 80, base: 20 },
      { id: 'roleplay', group: 'Agentes', name: 'Role play evaluativo (voz)', credits: 115, base: 0 },
      { id: 'escena', group: 'Video por escena', name: 'Video por escena, hasta 15 min', credits: 1000, base: 22 },
      { id: 'r-eval', group: 'Regeneraciones', name: 'Regenerar evaluación', credits: 20, base: 0 },
      { id: 'r-dialogo', group: 'Regeneraciones', name: 'Regenerar diálogo', credits: 20, base: 0 },
      { id: 'r-portada', group: 'Regeneraciones', name: 'Regenerar imagen de portada', credits: 10, base: 10 },
      { id: 'r-avatar', group: 'Regeneraciones', name: 'Regenerar video con avatar', credits: 60, base: 8 },
      { id: 'r-escena', group: 'Regeneraciones', name: 'Regenerar video por escena', credits: 60, base: 0 },
    ],
  },
};

export const DEFAULT_LMS_AI_USAGE_SET: LmsAiUsageSetId = 'artefacto';

export type UsageQuantities = Record<string, number>;

/** Las cantidades con que arranca el estimado de un conjunto. */
export function baseUsageQuantities(setId: LmsAiUsageSetId): UsageQuantities {
  return Object.fromEntries(LMS_AI_USAGE_SETS[setId].rows.map((row) => [row.id, row.base]));
}

/** Todo en cero. */
export function emptyUsageQuantities(setId: LmsAiUsageSetId): UsageQuantities {
  return Object.fromEntries(LMS_AI_USAGE_SETS[setId].rows.map((row) => [row.id, 0]));
}

/** Fija la misma cantidad de cursos completos en las filas que forman un curso. */
export function withCourses(setId: LmsAiUsageSetId, quantities: UsageQuantities, courses: number): UsageQuantities {
  const next = { ...quantities };
  for (const rowId of LMS_AI_USAGE_SETS[setId].course.rows) next[rowId] = courses;
  return next;
}

export function lmsAiCreditsUsed(setId: LmsAiUsageSetId, quantities: UsageQuantities): number {
  return LMS_AI_USAGE_SETS[setId].rows.reduce(
    (sum, row) => sum + row.credits * Math.max(0, quantities[row.id] ?? 0),
    0,
  );
}

export interface LmsAiUsage {
  used: number;
  capacity: number;
  ratio: number;
  fit: CreditFit;
  balance: number;
  coursesLeft: number;
  usdValue: number;
  monthly: number;
}

/** Consumo estimado frente al plan elegido (o al recomendado si no hay plan). */
export function lmsAiUsage(
  setId: LmsAiUsageSetId,
  quantities: UsageQuantities,
  tier: CreditTier | null,
  packs: number,
  pack: CreditPack,
): LmsAiUsage {
  const used = lmsAiCreditsUsed(setId, quantities);
  const planTier = tier ?? recommendCreditTier(used, pack)?.tier ?? 'basic';
  const plan = CREDIT_TIER_PLANS[planTier];
  const capacity = tier ? plan.credits + packs * pack.credits : plan.credits;
  const ratio = capacity > 0 ? used / capacity : 0;
  const balance = capacity - used;
  return {
    used,
    capacity,
    ratio,
    fit: creditFit(ratio),
    balance,
    coursesLeft: balance / LMS_AI_USAGE_SETS[setId].course.credits,
    usdValue: used * (plan.list / plan.credits),
    monthly: used / 12,
  };
}

// ── Selección: consumo por vacante ──────────────────────────────────────────

export const SELECTION_SERVICES = ['cv', 'entrevistas', 'roleplay', 'idiomas', 'psico', 'antecedentes'] as const;
export type SelectionService = (typeof SELECTION_SERVICES)[number];

/** Créditos por uso de cada servicio. */
export const SELECTION_SERVICE_CREDITS: Record<SelectionService, number> = {
  cv: 0,
  psico: 50,
  antecedentes: 50,
  entrevistas: 130,
  roleplay: 150,
  idiomas: 150,
};

export const SELECTION_SERVICE_LABELS: Record<SelectionService, string> = {
  cv: 'Puntaje de hoja de vida',
  psico: 'Pruebas psicométricas',
  antecedentes: 'Antecedentes',
  entrevistas: 'Entrevistas (SerenaAI)',
  roleplay: 'Role play',
  idiomas: 'Idiomas',
};

export type SelectionMix = Record<SelectionService, number>;

/** Usos por vacante según la industria del cliente. */
export const SELECTION_INDUSTRY_MIXES: readonly ({ label: string } & SelectionMix)[] = [
  { label: 'Seguros y servicios financieros', cv: 32, entrevistas: 30, roleplay: 18, idiomas: 12, psico: 1, antecedentes: 1 },
  { label: 'Gas, petróleo, energía y minería', cv: 21, entrevistas: 8, roleplay: 5, idiomas: 3, psico: 1, antecedentes: 1 },
  { label: 'Consumo masivo', cv: 60, entrevistas: 6, roleplay: 4, idiomas: 2, psico: 1, antecedentes: 1 },
  { label: 'Transporte y logística', cv: 65, entrevistas: 24, roleplay: 14, idiomas: 10, psico: 1, antecedentes: 15 },
  { label: 'Industria, manufactura, químicos y automotriz', cv: 19, entrevistas: 7, roleplay: 4, idiomas: 3, psico: 1, antecedentes: 1 },
  { label: 'Compañía de servicios', cv: 30, entrevistas: 12, roleplay: 7, idiomas: 5, psico: 1, antecedentes: 1 },
  { label: 'Salud y farmacéuticos', cv: 25, entrevistas: 3, roleplay: 2, idiomas: 1, psico: 15, antecedentes: 1 },
  { label: 'Propiedad y construcción', cv: 94, entrevistas: 4, roleplay: 2, idiomas: 2, psico: 1, antecedentes: 1 },
];

export const DEFAULT_SELECTION_VACANCIES = 30;

export function selectionMix(index: number): SelectionMix {
  const industry = SELECTION_INDUSTRY_MIXES[index] ?? SELECTION_INDUSTRY_MIXES[0];
  return Object.fromEntries(SELECTION_SERVICES.map((service) => [service, industry[service]])) as SelectionMix;
}

/** Créditos al año: vacantes × usos por vacante × créditos por uso. */
export function selectionCreditsUsed(vacancies: number, mix: SelectionMix): number {
  return SELECTION_SERVICES.reduce(
    (sum, service) => sum + Math.max(0, mix[service]) * vacancies * SELECTION_SERVICE_CREDITS[service],
    0,
  );
}

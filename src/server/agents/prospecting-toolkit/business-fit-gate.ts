/**
 * Business-Fit Gate — Hito 16AB.43.29
 *
 * Evalúa si un candidato encaja con el segmento B2B objetivo:
 * SaaS / ERP / CRM / LMS / HR Tech / e-learning corporativo / software empresarial.
 *
 * Señales positivas → fit high/medium
 * Señales negativas → fit low/reject (BPO sin producto tech, agencia de marketing,
 *                     staffing/call-center, directorio de partners)
 *
 * Sin IA. Sin llamadas externas. Completamente determinístico.
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type BusinessFitLevel = 'high' | 'medium' | 'low' | 'reject';

export type BusinessFitResult = {
  fit: BusinessFitLevel;
  reasons: string[];
  matchedSignals: string[];
  missingSignals: string[];
  /** Score de ranking: mayor = mejor posición antes del target cap. */
  rankingBonus: number;
};

export type BusinessFitInput = {
  name: string;
  website: string | null;
  domain: string | null;
  sourceSnippet?: string | null;
  sourceTitle?: string | null;
  /** Subindustrias solicitadas por el usuario en el wizard (opcional). */
  subindustries?: string[];
  /** Criterios adicionales del usuario (opcional). */
  additionalCriteria?: string | null;
};

// ─── Bonos de ranking por nivel de fit ───────────────────────────────────────

const RANKING_BONUS: Record<BusinessFitLevel, number> = {
  high: 50,
  medium: 30,
  low: -40,
  reject: -100,
};

// ─── Señales positivas ────────────────────────────────────────────────────────
// Indican que la empresa es un proveedor de software/tecnología B2B objetivo.

const POSITIVE_NAME_SIGNALS = [
  'saas', 'erp', 'crm', 'lms', 'hcm', 'hrm', 'rrhh', 'hr tech', 'hr-tech',
  'software', 'plataforma', 'platform', 'sistemas', 'system', 'tech', 'tecnolog',
  'digital', 'cloud', 'data', 'datos', 'analytics', 'ai ', 'inteligencia artificial',
  'automatizacion', 'automatización', 'robotica', 'robótica', 'rpa',
  'netsuite', 'sap', 'oracle', 'salesforce', 'workday', 'odoo', 'zoho',
  'soluciones empresariales', 'enterprise', 'corporativo', 'b2b',
  'e-learning', 'elearning', 'aprendizaje', 'formacion', 'capacitacion',
  'gestion', 'gestión', 'management',
];

const POSITIVE_DOMAIN_SIGNALS = [
  'saas', 'erp', 'crm', 'lms', 'hrm', 'hcm', 'cloud', 'tech', 'soft', 'sys',
  'digital', 'data', 'smart', 'ware', 'app', 'dev', 'solution', 'platform',
];

const POSITIVE_SNIPPET_SIGNALS = [
  'software empresarial', 'software para empresas', 'software de gestión',
  'plataforma para empresas', 'plataforma corporativa', 'plataforma digital',
  'implementación de crm', 'implementación crm', 'implementación erp', 'implementación lms',
  'implementación de erp', 'implementación de lms',
  'sistema de gestión', 'sistema erp', 'sistema crm',
  'soluciones de software', 'soluciones tecnológicas', 'soluciones empresariales',
  'servicios tecnológicos', 'servicios de ti', 'servicios de it', 'servicios de tecnología',
  'transformación digital', 'digitalización',
  'clientes corporativos', 'clientes empresariales', 'clientes b2b',
  'gestión del talento', 'gestión de talento', 'gestión de rrhh', 'gestión de nómina',
  'nómina', 'nomina', 'recursos humanos',
  'e-learning', 'elearning', 'lms', 'learning management', 'aprendizaje corporativo',
  'capacitación corporativa', 'formación empresarial',
  'saas', 'erp', 'crm', 'cloud computing',
  'automatización de procesos', 'rpa', 'inteligencia artificial',
];

// ─── Señales negativas ────────────────────────────────────────────────────────
// Indican segmentos que NO son el objetivo B2B software/tech.

/** Rechazo inmediato: agencia de marketing/publicidad/branding sin producto tech. */
const REJECT_NAME_SIGNALS = [
  'agencia de marketing', 'agencia marketing', 'agencia publicidad',
  'agencia digital', 'agencia creativa', 'agencia de medios',
  'agencia seo', 'agencia sem', 'agencia web',
  'marketing agency', 'digital agency', 'creative agency',
  'call center', 'callcenter', 'centro de llamadas', 'cobranza',
  'cobro de cartera', 'cartera de cobro', 'recuperacion de cartera',
  'outsourcing de personal', 'temporales de personal', 'empresa temporal',
  'staffing', 'headhunting', 'recruiting agency', 'agencia de empleo',
  'agencia de talento humano', 'agencia de seleccion',
];

const REJECT_SNIPPET_SIGNALS = [
  'agencia de marketing digital', 'somos una agencia', 'agencia especializada en marketing',
  'soluciones de marketing', 'estrategia de marketing', 'campañas publicitarias',
  'manejo de redes sociales', 'posicionamiento web seo',
  'call center', 'callcenter', 'contact center services',
  'recuperación de cartera', 'cobranza extrajudicial', 'cobro de cartera',
  'suministro de personal', 'temporal de personal', 'selección de personal',
  'outsourcing de personal', 'hunting de personal',
  // Freelance / micro providers — Hito v1.4: no son ICP corporativo
  'desarrolladores freelancer', 'desarrollador freelancer',
  'software a la medida de tu presupuesto', 'a la medida de tu presupuesto',
  'emprendimiento personal', 'portafolio personal',
];

/** Señales de bajo fit: consultoras/agencias generales sin producto propio. */
const LOW_FIT_NAME_SIGNALS = [
  'consultora', 'consultores', 'consulting', 'consultoría',
  'agencia', 'agency', 'publicidad', 'branding', 'comunicaciones',
  'bpo', 'outsourcing', 'tercerización', 'tercerization',
  'manpower', 'randstad', 'adecco', 'sgs ', 'bureauveritas', 'bureau veritas',
];

const LOW_FIT_SNIPPET_SIGNALS = [
  'servicios de impresión', 'logística de distribución',
  'transporte de mercancías', 'flota vehicular',
  'servicios de vigilancia', 'seguridad privada',
  'servicios de aseo', 'servicios de limpieza',
  'construcción de obras', 'contratista de obras',
  'distribución de productos', 'distribuidora de',
  // Micro/low-budget providers — Hito v1.4
  'software barato', 'páginas web baratas', 'paginas web baratas',
  'servicios económicos', 'servicios economicos',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function anySignalIn(signals: string[], text: string): string | null {
  for (const s of signals) {
    if (text.includes(normalizeText(s))) return s;
  }
  return null;
}

function countSignalsIn(signals: string[], text: string): number {
  return signals.filter((s) => text.includes(normalizeText(s))).length;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Evalúa el fit de un candidato con el segmento B2B SaaS/ERP/CRM/LMS/HR Tech.
 *
 * Usa señales del nombre, dominio y snippet del candidato.
 * Si se proveen subindustrias o additionalCriteria, los considera como contexto adicional.
 */
export function evaluateBusinessFit(input: BusinessFitInput): BusinessFitResult {
  const normalizedName = normalizeText(input.name);
  const normalizedSnippet = normalizeText(input.sourceSnippet ?? '');
  const normalizedTitle = normalizeText(input.sourceTitle ?? '');
  const normalizedDomain = normalizeText(input.domain ?? '');
  const combinedText = `${normalizedName} ${normalizedSnippet} ${normalizedTitle}`;

  const reasons: string[] = [];
  const matchedSignals: string[] = [];
  const missingSignals: string[] = [];

  // ── 1. Rechazo por señales negativas fuertes en el nombre ─────────────────────
  const rejectNameSignal = anySignalIn(REJECT_NAME_SIGNALS, normalizedName);
  if (rejectNameSignal) {
    reasons.push(`Nombre indica segmento excluido: "${rejectNameSignal}"`);
    return {
      fit: 'reject',
      reasons,
      matchedSignals: [rejectNameSignal],
      missingSignals,
      rankingBonus: RANKING_BONUS.reject,
    };
  }

  // ── 2. Rechazo por señales negativas fuertes en el snippet ────────────────────
  const rejectSnippetSignal = anySignalIn(REJECT_SNIPPET_SIGNALS, normalizedSnippet);
  if (rejectSnippetSignal) {
    reasons.push(`Snippet indica segmento excluido: "${rejectSnippetSignal}"`);
    return {
      fit: 'reject',
      reasons,
      matchedSignals: [rejectSnippetSignal],
      missingSignals,
      rankingBonus: RANKING_BONUS.reject,
    };
  }

  // ── 3. Señales positivas ──────────────────────────────────────────────────────
  const positiveNameCount = countSignalsIn(POSITIVE_NAME_SIGNALS, normalizedName);
  const positiveSnippetCount = countSignalsIn(POSITIVE_SNIPPET_SIGNALS, combinedText);
  const positiveDomainCount = countSignalsIn(POSITIVE_DOMAIN_SIGNALS, normalizedDomain);

  const totalPositive = positiveNameCount + positiveSnippetCount + positiveDomainCount;

  if (positiveNameCount > 0) matchedSignals.push(`nombre:${positiveNameCount}`);
  if (positiveSnippetCount > 0) matchedSignals.push(`snippet:${positiveSnippetCount}`);
  if (positiveDomainCount > 0) matchedSignals.push(`dominio:${positiveDomainCount}`);

  // ── 4. Señales de bajo fit ────────────────────────────────────────────────────
  const lowFitNameSignal = anySignalIn(LOW_FIT_NAME_SIGNALS, normalizedName);
  const lowFitSnippetSignal = anySignalIn(LOW_FIT_SNIPPET_SIGNALS, normalizedSnippet);

  const hasLowFitSignal = lowFitNameSignal != null || lowFitSnippetSignal != null;

  if (lowFitNameSignal) reasons.push(`Nombre sugiere bajo fit: "${lowFitNameSignal}"`);
  if (lowFitSnippetSignal) reasons.push(`Snippet sugiere bajo fit: "${lowFitSnippetSignal}"`);

  // ── 5. Contexto de subindustrias (opcional) ───────────────────────────────────
  const subinds = (input.subindustries ?? []).map(normalizeText);
  const criteria = normalizeText(input.additionalCriteria ?? '');
  const contextText = `${subinds.join(' ')} ${criteria}`.trim();

  // Si el contexto explícitamente menciona segmentos que encajan con el candidato
  const contextBoost =
    contextText.length > 0 &&
    (anySignalIn(POSITIVE_SNIPPET_SIGNALS, contextText) != null ||
      anySignalIn(POSITIVE_NAME_SIGNALS, contextText) != null);

  // ── 6. Determinar nivel de fit ────────────────────────────────────────────────

  if (totalPositive >= 3 && !hasLowFitSignal) {
    reasons.push(`Múltiples señales positivas de segmento B2B tech (${totalPositive})`);
    return {
      fit: 'high',
      reasons,
      matchedSignals,
      missingSignals,
      rankingBonus: RANKING_BONUS.high,
    };
  }

  if (totalPositive >= 1 || contextBoost) {
    if (hasLowFitSignal) {
      reasons.push('Señales positivas presentes pero contrarrestadas por señales de bajo fit');
      return {
        fit: 'low',
        reasons,
        matchedSignals,
        missingSignals,
        rankingBonus: RANKING_BONUS.low,
      };
    }
    reasons.push(`Señales positivas de segmento B2B tech (${totalPositive})`);
    return {
      fit: 'medium',
      reasons,
      matchedSignals,
      missingSignals,
      rankingBonus: RANKING_BONUS.medium,
    };
  }

  // Sin señales positivas
  missingSignals.push('software', 'saas', 'erp', 'crm', 'lms', 'plataforma');

  if (hasLowFitSignal) {
    reasons.push('Sin señales de segmento tech y con señales de bajo fit');
    return {
      fit: 'low',
      reasons,
      matchedSignals,
      missingSignals,
      rankingBonus: RANKING_BONUS.low,
    };
  }

  // Sin señales en ningún sentido → medium por defecto (no bloquear conservadoramente)
  reasons.push('Sin señales claras de fit — posible candidato neutro');
  return {
    fit: 'medium',
    reasons,
    matchedSignals,
    missingSignals,
    rankingBonus: RANKING_BONUS.medium,
  };
}

/** True si el candidato debe bloquearse por fit insuficiente. */
export function isBlockedByBusinessFit(result: BusinessFitResult): boolean {
  return result.fit === 'reject' || result.fit === 'low';
}

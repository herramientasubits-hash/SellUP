// ============================================================
// DEMO DATA — Datos ilustrativos para validación visual.
// Los costos de Apollo y Lusha reflejan precios reales del plan vigente.
// Volúmenes y métricas de efectividad son datos demo.
// ============================================================

export interface MockAgentStat {
  key: string;
  name: string;
  executions: number;
  estimatedCostUsd: number;
  resultsGenerated: number;
  resultsApproved: number;
  effectivenessRate: number;
  avgCostPerApproved: number;
  status: 'active' | 'idle' | 'planned';
}

export interface MockProviderStat {
  key: string;
  name: string;
  operation: string;
  calls: number;
  estimatedCostUsd: number;
  resultsReturned: number;
  usefulResults: number;
  effectivenessRate: number;
  avgCostPerUsefulResult: number;
}

export interface MockActivityItem {
  id: string;
  relativeTime: string;
  type: 'agent' | 'provider' | 'quality';
  providerOrAgent: string;
  operation: string;
  status: 'success' | 'error' | 'rate_limited';
  estimatedCostUsd: number;
  resultCount: number;
}

export interface MockSummary {
  totalCostUsd: number;
  totalExecutions: number;
  totalProviderCalls: number;
  totalApproved: number;
  avgEffectiveness: number;
  avgCostPerApproved: number;
}

export interface ProviderPlanInfo {
  key: string;
  name: string;
  planCostUsd: number;
  billingPeriod: 'monthly_billed_annually' | 'annual' | 'monthly';
  totalCredits: number;
  creditRenewalDate: string;
  unitCostUsd: number;
  unitLabel: string;
  notes: string;
}

// ============================================================
// Precios reales de proveedores — fuente: datos del plan vigente
// ============================================================

// Apollo: $4,200 USD anuales — 480,000 créditos compartidos — corte Oct 13
// Lusha:  $300 USD/mes (cobrado anualmente) — 40,800 créditos/mes — corte Nov

const APOLLO_UNIT_COST = 4200 / 480000;   // $0.00875 por crédito
const LUSHA_UNIT_COST  = 300  / 40800;    // $0.007353 por crédito (≈ $0.0074)

export const PROVIDER_PLANS: ProviderPlanInfo[] = [
  {
    key: 'apollo',
    name: 'Apollo',
    planCostUsd: 4200,
    billingPeriod: 'annual',
    totalCredits: 480000,
    creditRenewalDate: 'Oct 13',
    unitCostUsd: Math.round(APOLLO_UNIT_COST * 1e8) / 1e8,  // $0.00875000
    unitLabel: 'por crédito / resultado',
    notes: '$4,200 USD anuales · 480,000 créditos compartidos · Corte Oct 13',
  },
  {
    key: 'lusha',
    name: 'Lusha',
    planCostUsd: 300,
    billingPeriod: 'monthly_billed_annually',
    totalCredits: 40800,
    creditRenewalDate: 'Nov',
    unitCostUsd: Math.round(LUSHA_UNIT_COST * 1e8) / 1e8,   // $0.00735294
    unitLabel: 'por crédito / contacto',
    notes: '$300 USD/mes (cobrado anualmente) · 40,800 créditos/mes · Corte Nov',
  },
];

// ============================================================
// Agentes (demo)
// Costos incluyen IA + llamadas a proveedores del agente
// ============================================================

// Apollo: 820 resultados × $0.00875 = $7.175
// Lusha:  187 contactos  × $0.00735 = $1.375
// IA (Anthropic): $9.94
// Los costos de Apollo/Lusha se asignan al agente Generación de prospectos

const APOLLO_DEMO_COST = 820 * APOLLO_UNIT_COST;  // $7.18
const LUSHA_DEMO_COST  = 187 * LUSHA_UNIT_COST;   // $1.38

export const MOCK_AGENTS: MockAgentStat[] = [
  {
    key: 'prospect_generation',
    name: 'Generación de prospectos',
    executions: 14,
    // IA propia + Apollo + Lusha
    estimatedCostUsd: Math.round((4.82 + APOLLO_DEMO_COST + LUSHA_DEMO_COST) * 100) / 100,
    resultsGenerated: 312,
    resultsApproved: 187,
    effectivenessRate: 59.9,
    avgCostPerApproved: Math.round(((4.82 + APOLLO_DEMO_COST + LUSHA_DEMO_COST) / 187) * 10000) / 10000,
    status: 'active',
  },
  {
    key: 'account_intelligence',
    name: 'Inteligencia de cuenta',
    executions: 38,
    estimatedCostUsd: 1.94,
    resultsGenerated: 38,
    resultsApproved: 31,
    effectivenessRate: 81.6,
    avgCostPerApproved: 0.063,
    status: 'active',
  },
  {
    key: 'commercial_speech',
    name: 'Speech comercial',
    executions: 22,
    estimatedCostUsd: 2.31,
    resultsGenerated: 22,
    resultsApproved: 19,
    effectivenessRate: 86.4,
    avgCostPerApproved: 0.122,
    status: 'active',
  },
  {
    key: 'post_meeting_followup',
    name: 'Seguimiento post-reunión',
    executions: 11,
    estimatedCostUsd: 0.87,
    resultsGenerated: 11,
    resultsApproved: 9,
    effectivenessRate: 81.8,
    avgCostPerApproved: 0.097,
    status: 'idle',
  },
];

// ============================================================
// Proveedores — costos calculados con tarifas reales
// ============================================================

export const MOCK_PROVIDERS: MockProviderStat[] = [
  {
    key: 'apollo',
    name: 'Apollo',
    operation: 'Búsqueda de empresas',
    calls: 41,
    estimatedCostUsd: Math.round(APOLLO_DEMO_COST * 100) / 100,   // $7.18
    resultsReturned: 820,
    usefulResults: 312,
    effectivenessRate: 38.0,
    avgCostPerUsefulResult: Math.round((APOLLO_DEMO_COST / 312) * 10000) / 10000,  // $0.0230
  },
  {
    key: 'lusha',
    name: 'Lusha',
    operation: 'Enriquecimiento de contactos',
    calls: 187,
    estimatedCostUsd: Math.round(LUSHA_DEMO_COST * 100) / 100,    // $1.38
    resultsReturned: 187,
    usefulResults: 143,
    effectivenessRate: 76.5,
    avgCostPerUsefulResult: Math.round((LUSHA_DEMO_COST / 143) * 10000) / 10000,   // $0.0096
  },
  {
    key: 'hubspot',
    name: 'HubSpot',
    operation: 'Sincronización y consultas',
    calls: 312,
    estimatedCostUsd: 0,
    resultsReturned: 312,
    usefulResults: 291,
    effectivenessRate: 93.3,
    avgCostPerUsefulResult: 0,
  },
  {
    key: 'samu_ia',
    name: 'Samu IA',
    operation: 'Webhooks de reuniones',
    calls: 28,
    estimatedCostUsd: 0,
    resultsReturned: 28,
    usefulResults: 26,
    effectivenessRate: 92.9,
    avgCostPerUsefulResult: 0,
  },
  {
    key: 'anthropic',
    name: 'Anthropic (Claude)',
    operation: 'Generación y normalización IA',
    calls: 85,
    estimatedCostUsd: 9.94,
    resultsReturned: 85,
    usefulResults: 79,
    effectivenessRate: 92.9,
    avgCostPerUsefulResult: 0.126,
  },
];

// ============================================================
// Actividad reciente — costos Apollo/Lusha con tarifa real
// ============================================================

export const MOCK_ACTIVITY: MockActivityItem[] = [
  {
    id: '1',
    relativeTime: 'Hace 12 min',
    type: 'provider',
    providerOrAgent: 'Apollo',
    operation: 'company_search',
    status: 'success',
    // 20 resultados × $0.00875
    estimatedCostUsd: Math.round(20 * APOLLO_UNIT_COST * 10000) / 10000,
    resultCount: 20,
  },
  {
    id: '2',
    relativeTime: 'Hace 14 min',
    type: 'agent',
    providerOrAgent: 'Generación de prospectos',
    operation: 'Cascada Colombia / Textil',
    status: 'success',
    estimatedCostUsd: 0.69,
    resultCount: 22,
  },
  {
    id: '3',
    relativeTime: 'Hace 31 min',
    type: 'provider',
    providerOrAgent: 'Lusha',
    operation: 'person_enrich',
    status: 'success',
    // 18 contactos × $0.00735
    estimatedCostUsd: Math.round(18 * LUSHA_UNIT_COST * 10000) / 10000,
    resultCount: 18,
  },
  {
    id: '4',
    relativeTime: 'Hace 45 min',
    type: 'provider',
    providerOrAgent: 'Anthropic',
    operation: 'Normalización de prospectos',
    status: 'success',
    estimatedCostUsd: 0.11,
    resultCount: 22,
  },
  {
    id: '5',
    relativeTime: 'Hace 1 h',
    type: 'provider',
    providerOrAgent: 'Samu IA',
    operation: 'webhook_event',
    status: 'success',
    estimatedCostUsd: 0,
    resultCount: 1,
  },
  {
    id: '6',
    relativeTime: 'Hace 2 h',
    type: 'provider',
    providerOrAgent: 'HubSpot',
    operation: 'duplicate_check',
    status: 'success',
    estimatedCostUsd: 0,
    resultCount: 22,
  },
  {
    id: '7',
    relativeTime: 'Hace 3 h',
    type: 'agent',
    providerOrAgent: 'Inteligencia de cuenta',
    operation: 'Análisis empresa Bancolombia',
    status: 'success',
    estimatedCostUsd: 0.05,
    resultCount: 1,
  },
  {
    id: '8',
    relativeTime: 'Hace 4 h',
    type: 'provider',
    providerOrAgent: 'Apollo',
    operation: 'company_search',
    status: 'rate_limited',
    estimatedCostUsd: 0,
    resultCount: 0,
  },
];

// ============================================================
// Totales derivados
// ============================================================

function buildSummary(): MockSummary {
  const totalCostUsd = MOCK_AGENTS.reduce((s, a) => s + a.estimatedCostUsd, 0);
  const totalApproved = MOCK_AGENTS.reduce((s, a) => s + a.resultsApproved, 0);
  return {
    totalCostUsd: Math.round(totalCostUsd * 100) / 100,
    totalExecutions: MOCK_AGENTS.reduce((s, a) => s + a.executions, 0),
    totalProviderCalls: MOCK_PROVIDERS.reduce((s, p) => s + p.calls, 0),
    totalApproved,
    avgEffectiveness:
      Math.round(
        (MOCK_AGENTS.reduce((s, a) => s + a.effectivenessRate, 0) / MOCK_AGENTS.length) * 10
      ) / 10,
    avgCostPerApproved:
      totalApproved > 0
        ? Math.round((totalCostUsd / totalApproved) * 10000) / 10000
        : 0,
  };
}

export const MOCK_SUMMARY: MockSummary = buildSummary();

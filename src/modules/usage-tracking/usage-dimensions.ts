// ============================================================
// Dimensiones de cada consulta a un proveedor: qué agente y qué paso la hizo
//
// Espejo EXACTO de la función SQL `public.provider_usage_agent_dimensions` de la
// migración 147. La base de datos la usa en el disparador que rellena
// `provider_usage_logs.agent_key / agent_step` y en el relleno de las filas
// viejas; la página /ai-usage la usa para:
//   - dar nombre a cada agente y paso;
//   - calcular la misma etiqueta en memoria cuando la migración todavía no está
//     aplicada (la columna no existe) o la fila es anterior a ella.
//
// Una prueba lee el SQL de la migración y exige que sus reglas sean, en el mismo
// orden, las de RULES. Si cambias una, cambia las dos.
//
// Sin E/S: puro y apto para cliente y servidor.
// ============================================================

export type AgentDimensionKey = 'agent1' | 'agent2a';

/** Cómo se compara operation_key en una regla. */
export type OperationMatch =
  | { kind: 'any' }
  | { kind: 'in'; values: readonly string[] }
  | { kind: 'prefix'; value: string }
  | { kind: 'contains'; value: string };

export interface AgentDimensionRule {
  providers: readonly string[];
  operation: OperationMatch;
  /** metadata->>'flow' exigido; null = cualquiera. */
  flow: string | null;
  agentKey: AgentDimensionKey;
  agentStep: string;
}

const CONTACT_PROVIDERS = ['apollo', 'lusha'] as const;

/** Reglas en orden: gana la primera que cumple. */
export const AGENT_DIMENSION_RULES: readonly AgentDimensionRule[] = [
  // ── Agente 1: Claude ──
  {
    providers: ['anthropic'],
    operation: { kind: 'in', values: ['company_classification'] },
    flow: 'claude_rescue',
    agentKey: 'agent1',
    agentStep: 'rescate',
  },
  {
    providers: ['anthropic'],
    operation: { kind: 'in', values: ['company_classification'] },
    flow: null,
    agentKey: 'agent1',
    agentStep: 'clasificador',
  },
  {
    providers: ['anthropic'],
    operation: { kind: 'in', values: ['company_domain_search'] },
    flow: null,
    agentKey: 'agent1',
    agentStep: 'rescate_web',
  },
  {
    providers: ['anthropic'],
    operation: { kind: 'in', values: ['company_search'] },
    flow: null,
    agentKey: 'agent1',
    agentStep: 'claude_busca_empresas',
  },
  // ── Agente 1: búsqueda web (Tavily) ──
  {
    providers: ['tavily'],
    operation: {
      kind: 'in',
      values: ['multi_query_web_search', 'linkedin_company_search', 'rich_profile_enrichment', 'web_search'],
    },
    flow: null,
    agentKey: 'agent1',
    agentStep: 'busqueda_web',
  },
  // ── Agente 1: Apollo y Lusha de empresas ──
  {
    providers: ['apollo'],
    operation: { kind: 'in', values: ['organizations_search', 'mixed_companies_search'] },
    flow: null,
    agentKey: 'agent1',
    agentStep: 'apollo',
  },
  {
    providers: ['apollo'],
    operation: { kind: 'in', values: ['organization_enrichment'] },
    flow: null,
    agentKey: 'agent1',
    agentStep: 'enriquecer_empresa',
  },
  {
    providers: ['lusha'],
    operation: { kind: 'in', values: ['company_prospecting_v3'] },
    flow: null,
    agentKey: 'agent1',
    agentStep: 'lusha',
  },
  // ── Agente 1: duplicados en HubSpot ──
  {
    providers: ['hubspot'],
    operation: { kind: 'any' },
    flow: null,
    agentKey: 'agent1',
    agentStep: 'duplicados_hubspot',
  },
  // ── Agente 2A: contactos ──
  {
    providers: CONTACT_PROVIDERS,
    operation: { kind: 'in', values: ['people_search', 'bulk_people_search', 'contact_search', 'contacts_search'] },
    flow: null,
    agentKey: 'agent2a',
    agentStep: 'buscar_contactos',
  },
  {
    providers: CONTACT_PROVIDERS,
    operation: {
      kind: 'in',
      values: ['person_match', 'person_enrich', 'people_enrich', 'lusha_contact_search', 'lusha_contact_enrich'],
    },
    flow: null,
    agentKey: 'agent2a',
    agentStep: 'identificar_contacto',
  },
  {
    providers: CONTACT_PROVIDERS,
    operation: { kind: 'contains', value: 'cache_hit' },
    flow: null,
    agentKey: 'agent2a',
    agentStep: 'telefono_en_cache',
  },
  {
    providers: CONTACT_PROVIDERS,
    operation: { kind: 'contains', value: 'reveal' },
    flow: null,
    agentKey: 'agent2a',
    agentStep: 'revelar_telefono',
  },
  {
    providers: CONTACT_PROVIDERS,
    operation: { kind: 'contains', value: 'search_more' },
    flow: null,
    agentKey: 'agent2a',
    agentStep: 'revelar_telefono',
  },
  {
    providers: CONTACT_PROVIDERS,
    operation: { kind: 'prefix', value: 'lusha_contact_' },
    flow: null,
    agentKey: 'agent2a',
    agentStep: 'buscar_contactos',
  },
];

/**
 * Agente de una ejecución (agent_runs.agent_key) en el vocabulario de las
 * consultas. Espejo de `public.provider_usage_agent_from_run`. Una clave que no
 * es de ninguno de los dos agentes se conserva tal cual.
 */
export const RUN_AGENT_KEY_MAP: Readonly<Record<string, AgentDimensionKey>> = {
  prospect_generation: 'agent1',
  candidate_enrichment: 'agent1',
  agent_2a_contact_enrichment: 'agent2a',
};

export interface AgentDimensions {
  agentKey: string | null;
  agentStep: string | null;
}

function operationMatches(match: OperationMatch, operationKey: string | null): boolean {
  if (match.kind === 'any') return true;
  if (operationKey === null) return false;
  if (match.kind === 'in') return match.values.includes(operationKey);
  if (match.kind === 'prefix') return operationKey.startsWith(match.value);
  return operationKey.includes(match.value);
}

/** Agente y paso de una consulta según proveedor, operación y `metadata.flow`. */
export function resolveAgentDimensions(
  providerKey: string | null,
  operationKey: string | null,
  flow: string | null,
): AgentDimensions {
  if (!providerKey) return { agentKey: null, agentStep: null };
  for (const rule of AGENT_DIMENSION_RULES) {
    if (!rule.providers.includes(providerKey)) continue;
    if (!operationMatches(rule.operation, operationKey)) continue;
    if (rule.flow !== null && rule.flow !== flow) continue;
    return { agentKey: rule.agentKey, agentStep: rule.agentStep };
  }
  return { agentKey: null, agentStep: null };
}

export function agentKeyFromRunKey(runAgentKey: string | null | undefined): string | null {
  if (!runAgentKey) return null;
  return RUN_AGENT_KEY_MAP[runAgentKey] ?? runAgentKey;
}

/**
 * Lo mismo que hace el disparador: un valor ya escrito nunca se pisa; el paso
 * sólo se completa si la regla es del mismo agente que la fila.
 */
export function completeAgentDimensions(input: {
  providerKey: string | null;
  operationKey: string | null;
  flow: string | null;
  agentKey: string | null;
  agentStep: string | null;
  runAgentKey: string | null;
}): AgentDimensions {
  const rule = resolveAgentDimensions(input.providerKey, input.operationKey, input.flow);
  const agentKey = input.agentKey ?? rule.agentKey ?? agentKeyFromRunKey(input.runAgentKey);
  const agentStep = input.agentStep ?? (rule.agentKey === agentKey ? rule.agentStep : null);
  return { agentKey, agentStep };
}

// ── Lote → país, industria y forma de búsqueda ───────────────────────────────

export interface BatchDimensionSource {
  country_code: string | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
}

export interface BatchDimensions {
  countryCode: string | null;
  macroIndustryKey: string | null;
  searchMode: string | null;
}

/** Formas de búsqueda que se derivan del lote (espejo de la migración 147). */
export const SEARCH_MODE_BY_BATCH_SOURCE: Readonly<Record<string, string>> = {
  agent_1: 'exploratory',
  imported: 'import',
  external_import: 'import',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Bloques de la metadata del lote donde vive la macro industria, en orden. */
export const BATCH_MACRO_METADATA_BLOCKS = [
  'apollo_discovery_taxonomy',
  'claude_company_search',
  'lusha_run_observability',
] as const;

export function resolveBatchDimensions(batch: BatchDimensionSource | null | undefined): BatchDimensions {
  if (!batch) return { countryCode: null, macroIndustryKey: null, searchMode: null };
  const metadata = batch.metadata ?? {};
  let macroIndustryKey: string | null = null;
  for (const block of BATCH_MACRO_METADATA_BLOCKS) {
    macroIndustryKey = nonEmpty(asRecord(metadata[block])?.['macro_industry_key']);
    if (macroIndustryKey) break;
  }
  return {
    countryCode: nonEmpty(batch.country_code)?.toUpperCase() ?? null,
    macroIndustryKey,
    searchMode: batch.source ? SEARCH_MODE_BY_BATCH_SOURCE[batch.source] ?? null : null,
  };
}

// ── Nombres legibles ─────────────────────────────────────────────────────────

export const AGENT_DIMENSION_LABELS: Readonly<Record<string, string>> = {
  agent1: 'Agente 1 · Empresas',
  agent2a: 'Agente 2A · Contactos',
};

export const AGENT_STEP_LABELS: Readonly<Record<string, string>> = {
  clasificador: 'Clasificar sector y tamaño (Claude)',
  rescate: 'Rescate de descartadas (Claude)',
  rescate_web: 'Buscar la web de una descartada (Claude)',
  claude_busca_empresas: 'Claude busca empresas',
  busqueda_web: 'Búsqueda web (Tavily)',
  apollo: 'Buscar empresas en Apollo',
  enriquecer_empresa: 'Completar datos de empresa (Apollo)',
  lusha: 'Buscar empresas en Lusha',
  duplicados_hubspot: 'Revisar duplicados en HubSpot',
  buscar_contactos: 'Buscar contactos',
  identificar_contacto: 'Identificar contacto',
  revelar_telefono: 'Revelar teléfono',
  telefono_en_cache: 'Teléfono ya guardado',
};

export const SEARCH_MODE_LABELS: Readonly<Record<string, string>> = {
  exploratory: 'Empresas por industria',
  competitors: 'Competidores',
  suppliers: 'Proveedores',
  import: 'Importación',
};

function humanize(key: string): string {
  const text = key.replace(/_/g, ' ').trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : key;
}

export function agentDimensionLabel(key: string | null): string {
  if (!key) return 'Sin agente identificado';
  return AGENT_DIMENSION_LABELS[key] ?? humanize(key);
}

export function agentStepLabel(step: string | null): string {
  if (!step) return 'Otro paso';
  return AGENT_STEP_LABELS[step] ?? humanize(step);
}

export function searchModeLabel(mode: string | null): string {
  if (!mode) return 'Sin forma registrada';
  return SEARCH_MODE_LABELS[mode] ?? humanize(mode);
}

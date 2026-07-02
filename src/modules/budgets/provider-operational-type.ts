// ============================================================
// budgets — provider operational type classification (Hito Q2)
// ============================================================
// Pure frontend helper. No DB access. Maps provider keys to
// operational categories and contextual descriptions shown in
// the unified providers table.
// ============================================================

export type ProviderOperationalType = 'ia' | 'busqueda' | 'enriquecimiento' | 'integracion';

const PROVIDER_TYPE_MAP: Record<string, ProviderOperationalType> = {
  anthropic:  'ia',
  openai:     'ia',
  gemini:     'ia',
  tavily:     'busqueda',
  lusha:      'enriquecimiento',
  apollo:     'enriquecimiento',
  samu_ia:    'integracion',
};

export function getProviderOperationalType(providerKey: string): ProviderOperationalType {
  return PROVIDER_TYPE_MAP[providerKey.toLowerCase()] ?? 'ia';
}

export const OPERATIONAL_TYPE_LABEL: Record<ProviderOperationalType, string> = {
  ia:              'IA',
  busqueda:        'Búsqueda',
  enriquecimiento: 'Enriquecimiento',
  integracion:     'Integración',
};

export const OPERATIONAL_TYPE_BADGE: Record<ProviderOperationalType, string> = {
  ia:              'border-su-brand/30 bg-su-brand-soft text-su-brand',
  busqueda:        'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  enriquecimiento: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  integracion:     'border-border/40 bg-muted/30 text-muted-foreground',
};

// Operational context line per provider (second line in Proveedor cell)
const PROVIDER_CONTEXT_MAP: Record<string, string> = {
  anthropic: 'Proveedor LLM · Presupuesto USD manual',
  openai:    'Proveedor LLM · Pendiente de conexión',
  gemini:    'Proveedor LLM · Pendiente de conexión',
  tavily:    'Búsqueda web / señales externas',
  lusha:     'Enriquecimiento de contactos',
  apollo:    'Prospección y enriquecimiento',
  samu_ia:   'Post-reunión / no medido desde SellUp',
};

export function getProviderOperationalContext(providerKey: string): string {
  return PROVIDER_CONTEXT_MAP[providerKey.toLowerCase()] ?? 'Proveedor externo';
}

// Configuration summary per provider (replaces "Acción configurada")
const PROVIDER_CONFIG_SUMMARY_MAP: Record<string, string> = {
  anthropic: 'Presupuesto USD manual',
  openai:    'Modelos y tarifas',
  gemini:    'Modelos y tarifas',
  tavily:    'Cuota + sync',
  lusha:     'Cuota + sync',
  apollo:    'Cuota manual',
  samu_ia:   'No aplica',
};

export function getProviderConfigSummary(providerKey: string): string {
  return PROVIDER_CONFIG_SUMMARY_MAP[providerKey.toLowerCase()] ?? '—';
}

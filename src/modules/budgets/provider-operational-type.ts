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
  ia:              'border-primary/30 bg-primary/10 text-primary',
  busqueda:        'border-warning/30 bg-warning/10 text-warning',
  enriquecimiento: 'border-info/30 bg-info/10 text-info',
  integracion:     'border-border/60 bg-surface-subtle text-muted-foreground',
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

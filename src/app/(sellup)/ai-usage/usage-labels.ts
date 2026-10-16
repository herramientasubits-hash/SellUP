// Nombres legibles y formatos de /ai-usage, en un solo sitio: la página, los
// filtros y el panel del Agente 1 tienen que llamar igual a lo mismo.

import type { StatusType } from '@/components/data-display';
import { UNATTRIBUTED_AGENT_KEY } from '@/modules/ai-usage/usage-aggregators';
import { getMacroIndustryByKey } from '@/modules/macro-industry-catalog/macro-industries';
import { countryName } from '@/components/shared/table-cells';

// Claves que el código escribe en provider_usage_logs.provider_key (o en
// pantallas de proveedor). Una clave sin traducción se muestra cruda.
const PROVIDER_NAMES: Record<string, string> = {
  tavily: 'Tavily',
  anthropic: 'Anthropic (Claude)',
  claude: 'Anthropic (Claude)',
  openai: 'OpenAI',
  google: 'Google (Gemini)',
  gemini: 'Google (Gemini)',
  apollo: 'Apollo',
  apollo_organizations: 'Apollo',
  lusha: 'Lusha',
  hubspot: 'HubSpot',
  samu_ia: 'Samu IA',
  migo: 'Migo (Perú)',
};

// Claves de agent_runs.agent_key que crean ejecuciones hoy, más las previstas.
const AGENT_NAMES: Record<string, string> = {
  prospect_generation: 'Generación de prospectos',
  candidate_enrichment: 'Enriquecimiento de candidatos',
  agent_2a_contact_enrichment: 'Enriquecimiento de contactos',
  account_intelligence: 'Inteligencia de cuenta',
  commercial_speech: 'Speech comercial',
  post_meeting_followup: 'Seguimiento post-reunión',
  [UNATTRIBUTED_AGENT_KEY]: 'Sin agente asignado',
};

interface StatusPresentation {
  label: string;
  type: StatusType;
}

const STATUS_PRESENTATION: Record<string, StatusPresentation> = {
  completed: { label: 'Completado', type: 'completed' },
  success: { label: 'Correcto', type: 'completed' },
  running: { label: 'En curso', type: 'info' },
  pending: { label: 'Pendiente', type: 'pending' },
  failed: { label: 'Falló', type: 'error' },
  error: { label: 'Error', type: 'error' },
  cancelled: { label: 'Cancelado', type: 'neutral' },
  rate_limited: { label: 'Demasiadas consultas', type: 'warning' },
  quota_exceeded: { label: 'Sin cupo', type: 'error' },
  no_new_candidates: { label: 'Sin resultados nuevos', type: 'neutral' },
};

/** `search_companies` → «Search companies»: legible aunque no haya traducción. */
export function humanizeKey(key: string): string {
  const text = key.replace(/_/g, ' ').trim();
  return text.length === 0 ? key : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function providerLabel(providerKey: string): string {
  return PROVIDER_NAMES[providerKey] ?? providerKey;
}

export function agentLabel(agentKey: string, agentName?: string | null): string {
  return AGENT_NAMES[agentKey] ?? agentName ?? agentKey;
}

export function statusPresentation(status: string): StatusPresentation {
  return STATUS_PRESENTATION[status] ?? { label: humanizeKey(status), type: 'neutral' };
}

export function statusLabel(status: string): string {
  return statusPresentation(status).label;
}

const TINY_COST_THRESHOLD_USD = 0.001;

/** Un costo en dólares. Los importes diminutos conservan decimales para no leerse como cero. */
export function formatUsd(usd: number, decimals = 2): string {
  if (usd === 0) return '$0.00';
  if (usd < TINY_COST_THRESHOLD_USD) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(decimals)}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString('es-ES');
}

/** «CO» → «Colombia». Sin país: lo dice con palabras. */
export function countryLabel(code: string | null): string {
  return countryName(code) ?? 'Sin país';
}

/** Clave de macro industria → su nombre del catálogo. */
export function industryLabel(key: string | null): string {
  if (!key) return 'Sin industria';
  return getMacroIndustryByKey(key)?.displayName ?? humanizeKey(key);
}

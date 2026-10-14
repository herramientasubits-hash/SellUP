import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import type { ProspectSearchModeDefinition } from './wizard-types';

// ── Mode definitions ──────────────────────────────────────────────────────────

export const SEARCH_MODE_DEFINITIONS: ProspectSearchModeDefinition[] = [
  {
    mode: 'exploratory',
    label: 'Empresas por criterios',
    description: 'Busca empresas según país, industria y criterios específicos.',
    availability: 'enabled',
  },
  {
    // AGENT1-CORPORATE-TREE-1 — el chat la muestra «Próximamente» si la ruta dice
    // que está apagada (ENABLE_AGENT1_CORPORATE_TREE_SEARCH).
    mode: 'corporate_tree',
    label: 'Árbol de una empresa',
    description: 'Desde una empresa, encuentra su grupo y matriz, sus filiales y dónde opera en otros países.',
    availability: 'enabled',
  },
  {
    mode: 'competitors',
    label: 'Competidores de una empresa',
    description: 'Encuentra empresas similares a una de referencia.',
    availability: 'coming_soon',
  },
  {
    mode: 'suppliers',
    label: 'Proveedores de una empresa',
    description: 'Identifica proveedores relevantes para una empresa.',
    availability: 'coming_soon',
  },
];

// ── Valid country codes (derived from LATAM_COUNTRIES, not hardcoded) ─────────

export const VALID_COUNTRY_CODES: ReadonlySet<string> = new Set(
  LATAM_COUNTRIES.map((c) => c.code),
);

// ── GO_BACK transition map ────────────────────────────────────────────────────
// Deterministic — no mutable navigation history required.

export const GO_BACK_MAP = {
  search_type: 'welcome',
  corporate_tree: 'search_type',
  country: 'search_type',
  industry: 'country',
  subindustries: 'industry',
  additional_criteria: 'subindustries',
  summary: 'additional_criteria',
  validating: 'summary',
  validated: 'summary',
  blocked: 'summary',
  error: 'summary',
  welcome: null,
} as const satisfies Partial<Record<string, string | null>>;

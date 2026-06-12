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

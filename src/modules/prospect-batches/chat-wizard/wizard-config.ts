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
    description: 'Encuentra empresas que compiten con una de referencia.',
    availability: 'enabled',
  },
  {
    mode: 'suppliers',
    label: 'Proveedores de una empresa',
    description: 'Identifica proveedores relevantes para una empresa.',
    availability: 'coming_soon',
  },
];

/**
 * AGENT1-SUPPLIER-SEARCH-1 — las formas de búsqueda para ESTA conversación. Con la
 * bandera del servidor encendida, «Proveedores de una empresa» queda disponible; el
 * resto, como siempre.
 */
export function resolveSearchModeDefinitions(options: {
  supplierSearchEnabled?: boolean;
}): ProspectSearchModeDefinition[] {
  if (options.supplierSearchEnabled !== true) return SEARCH_MODE_DEFINITIONS;
  return SEARCH_MODE_DEFINITIONS.map((def) =>
    def.mode === 'suppliers'
      ? {
          ...def,
          description: 'Empresas que le venden a una empresa que tú eliges.',
          availability: 'enabled' as const,
        }
      : def,
  );
}

/** Empresa de referencia: lo que se escribe en el paso «¿De qué empresa?». */
export const REFERENCE_COMPANY_LIMITS = { minChars: 2, maxChars: 120 } as const;

// ── Valid country codes (derived from LATAM_COUNTRIES, not hardcoded) ─────────

export const VALID_COUNTRY_CODES: ReadonlySet<string> = new Set(
  LATAM_COUNTRIES.map((c) => c.code),
);

// ── GO_BACK transition map ────────────────────────────────────────────────────
// Deterministic — no mutable navigation history required.

export const GO_BACK_MAP = {
  search_type: 'welcome',
  reference_company: 'search_type',
  reference_confirm: 'reference_company',
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

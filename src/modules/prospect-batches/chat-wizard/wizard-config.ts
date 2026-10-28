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
 * GROWTH-BULK-SEARCH-1 — la quinta forma de buscar, sólo para Growth y admin con la
 * bandera encendida. No es un modo del motor: son las preguntas de «Empresas por
 * criterios» (`exploratory`) y, al final, la cantidad y el tope de la búsqueda masiva.
 */
export const BULK_SEARCH_OPTION = {
  value: 'bulk',
  label: 'Muchas empresas por criterios',
  description: 'Hasta 200 empresas de un país e industria, por rondas, con un tope de créditos que tú confirmas.',
} as const;

/** Cómo se nombra la forma elegida en el chat y en el resumen. */
export function searchModeDisplayLabel(state: {
  searchMode: ProspectSearchModeDefinition['mode'] | null;
  bulkIntent?: boolean;
  supplierSearchEnabled?: boolean;
}): string | null {
  if (state.bulkIntent === true) return BULK_SEARCH_OPTION.label;
  if (state.searchMode === null) return null;
  return resolveSearchModeDefinitions(state).find((d) => d.mode === state.searchMode)?.label ?? state.searchMode;
}

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

/**
 * «Competidores de una empresa»: países por búsqueda. Se lanza una corrida por país
 * (en paralelo en el Centro de procesos, que corre hasta 3 a la vez).
 */
export const MAX_COMPETITOR_COUNTRIES = 3;

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
  corporate_tree: 'search_type',
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

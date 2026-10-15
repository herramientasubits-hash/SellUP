/**
 * Entradas del Catálogo de fuentes de las compras públicas de «Proveedores de una
 * empresa» por país (AGENT1-SUPPLIER-SEARCH-ALL-1). Cada país pone la suya en
 * `<cc>.catalog.ts` y se agrega aquí con una línea; `source-catalog.ts` las incluye.
 * Estado: `connected_free_discovery` (nunca `connected`: cambiaría puntajes).
 * Colombia y Chile siguen en `source-catalog.ts` (co_secop2_buyer_suppliers, cl_chilecompra_orders).
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { AR_COMPRAR_CATALOG_SOURCE } from './ar.catalog';
import { BR_PUBLIC_PROCUREMENT_CATALOG_SOURCE } from './br.catalog';
import { CR_CATALOG_SOURCE } from './cr.catalog';
import { DO_PROCUREMENT_CATALOG_SOURCE } from './do.catalog';
import { EC_CATALOG_SOURCE } from './ec.catalog';
import { ES_PLACSP_AWARDS_CATALOG_SOURCE } from './es.catalog';
import { GT_CATALOG_SOURCE } from './gt.catalog';
import { HN_CATALOG_SOURCE } from './hn.catalog';
import { PA_PROCUREMENT_CATALOG_SOURCE } from './pa.catalog';
import { PE_CATALOG_SOURCE } from './pe.catalog';
import { PY_CATALOG_SOURCE } from './py.catalog';
import { US_PUBLIC_PROCUREMENT_CATALOG_SOURCE } from './us.catalog';
import { UY_ARCE_AWARDS_CATALOG_SOURCE } from './uy.catalog';

export const PUBLIC_PROCUREMENT_CATALOG_SOURCES: readonly CatalogSource[] = [
  PE_CATALOG_SOURCE,
  HN_CATALOG_SOURCE,
  GT_CATALOG_SOURCE,
  PY_CATALOG_SOURCE,
  PA_PROCUREMENT_CATALOG_SOURCE,
  DO_PROCUREMENT_CATALOG_SOURCE,
  BR_PUBLIC_PROCUREMENT_CATALOG_SOURCE,
  US_PUBLIC_PROCUREMENT_CATALOG_SOURCE,
  AR_COMPRAR_CATALOG_SOURCE,
  UY_ARCE_AWARDS_CATALOG_SOURCE,
  ES_PLACSP_AWARDS_CATALOG_SOURCE,
  EC_CATALOG_SOURCE,
  CR_CATALOG_SOURCE,
];

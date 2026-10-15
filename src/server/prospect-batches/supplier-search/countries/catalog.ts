/**
 * Entradas del Catálogo de fuentes de las compras públicas de «Proveedores de una
 * empresa» por país (AGENT1-SUPPLIER-SEARCH-ALL-1). Cada país pone la suya en
 * `<cc>.catalog.ts` y se agrega aquí con una línea; `source-catalog.ts` las incluye.
 * Estado: `connected_free_discovery` (nunca `connected`: cambiaría puntajes).
 * Colombia y Chile siguen en `source-catalog.ts` (co_secop2_buyer_suppliers, cl_chilecompra_orders).
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { EC_CATALOG_SOURCE } from './ec.catalog';

export const PUBLIC_PROCUREMENT_CATALOG_SOURCES: readonly CatalogSource[] = [
  EC_CATALOG_SOURCE,
];

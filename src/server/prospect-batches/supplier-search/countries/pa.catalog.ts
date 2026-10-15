/**
 * Panamá — entrada del Catálogo de fuentes de PanamaCompra en Cifras para «Proveedores
 * de una empresa» (AGENT1-SUPPLIER-SEARCH-ALL-1). Nunca `connected`.
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { PA_PANAMACOMPRA_SOURCE_KEY } from './pa';

export const PA_PROCUREMENT_CATALOG_SOURCE: CatalogSource = {
  key: PA_PANAMACOMPRA_SOURCE_KEY,
  name: 'PanamaCompra en Cifras — adjudicaciones OCDS mensuales («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_snapshot',
  nextAction:
    'Conectada en el código (AGENT1-SUPPLIER-SEARCH-ALL-1) sólo para «Proveedores de una empresa» en Panamá. Falta la carga del resumen (scripts/source-catalog/run-public-procurement-load.ts --country PA --end <último mes> --months 12, con autorización): el dry-run del 15-10 (oct-2025 a sep-2026) dio 3.002 pares entidad × proveedor empresa con al menos US$10 mil, 106 entidades y 1.212 proveedores (2,3 MB). Sin carga, el paso no reconoce ninguna entidad y sigue sólo Claude.',
  countryCodes: ['PA'],
  sectors: [],
  priority: 'P1',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: 'https://www.panamacompraencifras.gob.pa/',
  automationLevel: 'medium',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: con la referencia reconocida entre las entidades compradoras cargadas (Caja de Seguro Social, Ministerio de Salud…), se leen sus proveedores con RUC de persona jurídica y al menos US$10 mil adjudicados en 12 meses, filtrados por la industria pedida según el UNSPSC de los ítems que le adjudicaron a ESA entidad (tabla aprobada, regla del 50 %). Web sólo de la capa gratuita (pa_free_directory, pocas): el resto va a Descartadas para que el rescate de Claude busque el sitio. Cada candidato lleva «Proveedor de X» con el proceso en PanamaCompra como prueba.',
  limitations: [
    'Sin consulta en vivo: se cargan los archivos OCDS mensuales (5–28 MB comprimidos por mes; un mes puede dar timeout y hay que repetirlo).',
    'Hay que recargar cada mes para no quedar atrás.',
    'Empresa = RUC tomo-folio-asiento con el primer bloque de 3 o más dígitos: fuera cédulas de personas naturales, extranjeros y entidades «NT».',
    'Sin tamaño oficial y casi sin web (65 de 608 en pa_free_directory): el rendimiento depende del rescate de Claude (cuesta).',
    'Muchas compras menores (< US$10 mil): las entidades chicas casi no tienen pares sobre el piso.',
  ],
  riskNotes: [
    'Nunca se guardan personas, contactos ni el texto de las adjudicaciones: sólo el resumen comprador × proveedor empresa.',
    'Tabla public_procurement_supplier_links sólo para service_role (RLS sin políticas).',
    'El registro OCP avisa que el id del proveedor a veces no coincide con parties: aquí se usa awards.suppliers[].id, que en lo revisado es el RUC.',
  ],
};

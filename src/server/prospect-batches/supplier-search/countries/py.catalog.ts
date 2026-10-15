/**
 * Paraguay — entrada del Catálogo de fuentes de las adjudicaciones de la DNCP para
 * «Proveedores de una empresa» (AGENT1-SUPPLIER-SEARCH-ALL-1).
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { PY_DNCP_AWARDS_SOURCE_KEY } from './py';

export const PY_CATALOG_SOURCE: CatalogSource = {
  key: PY_DNCP_AWARDS_SOURCE_KEY,
  name: 'DNCP — adjudicaciones (OCDS, ZIP masivo) («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_snapshot',
  nextAction:
    'Conectada en el código (AGENT1-SUPPLIER-SEARCH-ALL-1) sólo para «Proveedores de una empresa» en Paraguay. Necesita la carga del resumen (scripts/source-catalog/run-public-procurement-load.ts --country PY, 12 meses; dry-run 15-10-2026: 2.480 pares, 224 entidades, 1.000 proveedores, 1,9 MB). Sin carga, el paso no reconoce ninguna entidad y sigue sólo Claude. Con un token de la DNCP (cuenta gratuita) podría pasar a consulta en vivo.',
  countryCodes: ['PY'],
  sectors: [],
  priority: 'P1',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: 'https://www.contrataciones.gov.py/datos/',
  automationLevel: 'medium',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: con la referencia reconocida entre las unidades de contratación cargadas («Ministerio de Salud» → MINISTERIO DE SALUD PUBLICA Y BIENESTAR SOCIAL MSPBS), se leen sus proveedores con RUC de empresa que suman al menos PYG 78 millones adjudicados en la ventana, filtrados por la industria pedida según el UNSPSC de los ítems adjudicados (tabla aprobada de Paraguay, regla del 50 %). Web del directorio DNCP cuando la hay. Cada candidato lleva «Proveedor de X» con un documento de la adjudicación en contrataciones.gov.py como prueba.',
  limitations: [
    'Sin consulta en vivo: la búsqueda de la API v3 no trae monto ni ítems y, sin token, el tope es de 15 llamadas por minuto (una por proceso haría falta); se carga el ZIP masivo anual y se recarga cada mes.',
    'El monto adjudicado puede ser el techo de un contrato marco, no lo gastado: el piso es un filtro grueso.',
    'Cada unidad de contratación (hospital, regional) es una entidad distinta: el ministerio es sólo su unidad central.',
    'Sin tamaño oficial (trabajadores) en SellUp; web para ~820 RUC (directorio DNCP).',
  ],
  riskNotes: [
    'Fuera personas físicas (RUC < 80.000.000), consorcios, extranjeras sin RUC y entidades del Estado (por nombre).',
    'Nunca se guardan personas, contactos, cuentas ni el texto de las compras: sólo el resumen entidad × proveedor.',
    'Licencia CC BY 4.0 (DNCP).',
  ],
};

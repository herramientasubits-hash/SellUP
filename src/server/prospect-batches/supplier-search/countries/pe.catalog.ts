/**
 * Perú — entrada del Catálogo de fuentes de OECE Contrataciones Abiertas para
 * «Proveedores de una empresa» (AGENT1-SUPPLIER-SEARCH-ALL-1).
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { PE_OECE_SOURCE_KEY } from './pe';

export const PE_CATALOG_SOURCE: CatalogSource = {
  key: PE_OECE_SOURCE_KEY,
  name: 'OECE Contrataciones Abiertas (SEACE) — contratos firmados («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_snapshot',
  nextAction:
    'Conectada en el código (AGENT1-SUPPLIER-SEARCH-ALL-1) sólo para «Proveedores de una empresa» en Perú. Necesita la carga del resumen (scripts/source-catalog/run-public-procurement-load.ts --country PE, 12 meses; dry-run 15-10-2026: 24.240 pares entidad × proveedor, 2.515 entidades, 12.044 proveedores, 16 MB). Sin carga, el paso no reconoce ninguna entidad y sigue sólo Claude.',
  countryCodes: ['PE'],
  sectors: [],
  priority: 'P1',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: 'https://data.open-contracting.org/en/publication/135',
  automationLevel: 'medium',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: con la referencia reconocida entre las entidades compradoras cargadas (nombre normalizado del OCDS: «SEGURO SOCIAL DE SALUD», «MINISTERIO DE SALUD»), se leen sus proveedores con RUC 20 que suman al menos PEN 34.000 en contratos firmados en la ventana, filtrados por la industria pedida según el UNSPSC de lo que más le venden a ESA entidad (tabla aprobada, regla del 50 %). Tamaño oficial con los trabajadores de SUNAT; web del directorio SUNAT cuando la hay. Cada candidato lleva «Proveedor de X» con el PDF del contrato en SEACE como prueba.',
  limitations: [
    'Sin consulta en vivo: la API de OECE responde 403 sin credencial; se carga el archivo completo del OCP Data Registry (~1,97 GB, toda la historia) y se filtra por fecha de firma.',
    'Hay que recargar cada mes (una descarga de ~40 min y ~2 min de lectura).',
    'El OCDS de OECE excluye las compras sin procedimiento menores a 8 UIT.',
    '~22 % de los pares no tiene UNSPSC en sus ítems (procesos antiguos o sin catálogo): esos no se pueden clasificar y no se ofrecen.',
    'Cada hospital, red o unidad ejecutora es una entidad distinta: «Ministerio de Salud» es sólo la sede.',
    'Web sólo para ~170 RUC (directorio SUNAT): el resto depende del rescate de Claude.',
  ],
  riskNotes: [
    'Fuera personas naturales (RUC 10), consorcios y entidades públicas (por nombre o porque también compran en el OCDS).',
    'Nunca se guardan personas, contactos, cuentas ni el texto de los contratos: sólo el resumen comprador × proveedor.',
    'Licencia CC BY 4.0 (OECE).',
  ],
};

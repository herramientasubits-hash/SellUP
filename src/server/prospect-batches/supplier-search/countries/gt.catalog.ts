/**
 * Guatemala — entrada del Catálogo de fuentes de Guatecompras para «Proveedores de una
 * empresa» (AGENT1-SUPPLIER-SEARCH-ALL-1).
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { GT_GUATECOMPRAS_SOURCE_KEY } from './gt';

export const GT_CATALOG_SOURCE: CatalogSource = {
  key: GT_GUATECOMPRAS_SOURCE_KEY,
  name: 'Guatecompras — adjudicaciones (OCDS del Ministerio de Finanzas) («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_snapshot',
  nextAction:
    'Conectada en el código (AGENT1-SUPPLIER-SEARCH-ALL-1) sólo para «Proveedores de una empresa» en Guatemala. Necesita la carga del resumen (scripts/source-catalog/run-public-procurement-load.ts --country GT, 12 meses; dry-run 15-10-2026: 8.422 pares, 539 entidades, 3.079 proveedores, 6 MB). Sin carga, el paso no reconoce ninguna entidad y sigue sólo Claude.',
  countryCodes: ['GT'],
  sectors: [],
  priority: 'P2',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: 'https://data.open-contracting.org/en/publication/142',
  automationLevel: 'medium',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: con la referencia reconocida entre las entidades compradoras cargadas (nombre del OCDS: «MINISTERIO PÚBLICO», «INSTITUTO GUATEMALTECO DE SEGURIDAD SOCIAL IGSS»), se leen sus proveedores con NIT válido y nombre de sociedad que suman al menos GTQ 77.000 adjudicados en la ventana, filtrados por la industria pedida según el UNSPSC de los ítems del proceso (tabla aprobada, regla del 50 %). Web del directorio de Guatecompras cuando la hay. Cada candidato lleva «Proveedor de X» con la página del proceso (NOG) en Guatecompras como prueba.',
  limitations: [
    'Sin consulta en vivo (guatecompras.gt bloquea clientes automáticos): se cargan los archivos anuales del OCP Data Registry (~330 MB/año); recargar cada mes.',
    'El UNSPSC es del proceso, no de lo adjudicado a cada proveedor: en procesos mixtos el monto se reparte por número de ítems.',
    'Montos publicados por adjudicación: la misma adjudicación repetida por dueño (copropiedades) se reparte entre las copias; dos lotes distintos con igual monto, fecha y título también se repartirían (raro).',
    'Sin tamaño oficial (trabajadores) en SellUp; web para ~750 NIT (directorio de Guatecompras).',
  ],
  riskNotes: [
    'Fuera personas («APELLIDO,APELLIDO,,NOMBRE»), copropiedades, negocios en participación, consorcios y entidades del Estado (por nombre o porque también compran).',
    'Nunca se guardan personas, contactos, cuentas ni el texto de las compras: sólo el resumen entidad × proveedor.',
  ],
};

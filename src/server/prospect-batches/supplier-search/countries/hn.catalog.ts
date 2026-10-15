/**
 * Honduras — entrada del Catálogo de fuentes de ONCAE/HonduCompras para «Proveedores de
 * una empresa» (AGENT1-SUPPLIER-SEARCH-ALL-1).
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { HN_ONCAE_SOURCE_KEY } from './hn';

export const HN_CATALOG_SOURCE: CatalogSource = {
  key: HN_ONCAE_SOURCE_KEY,
  name: 'ONCAE / HonduCompras — adjudicaciones (OCDS) («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_snapshot',
  nextAction:
    'Conectada en el código (AGENT1-SUPPLIER-SEARCH-ALL-1) sólo para «Proveedores de una empresa» en Honduras. Necesita la carga del resumen (scripts/source-catalog/run-public-procurement-load.ts --country HN, 12 meses; dry-run 15-10-2026: 1.077 pares, 93 instituciones, 658 proveedores, 0,7 MB). Sin carga, el paso no reconoce ninguna entidad y sigue sólo Claude.',
  countryCodes: ['HN'],
  sectors: [],
  priority: 'P2',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: 'https://data.open-contracting.org/en/publication/122',
  automationLevel: 'medium',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: con la referencia reconocida entre las instituciones compradoras cargadas (la clave del registro de entidades: «Secretaría de Salud» → SECRETARIA SALUD PUBLICA), se leen sus proveedores con RTN jurídico que suman al menos HNL 260.000 en la ventana, filtrados por la industria pedida según el UNSPSC de los ítems adjudicados (tabla aprobada, regla del 50 %). Las unidades ejecutoras (hospitales, regionales) se suman a su institución. Web del directorio de HonduCompras cuando la hay. Cada candidato lleva «Proveedor de X» con el contrato u orden de compra en HonduCompras como prueba.',
  limitations: [
    'Sin consulta en vivo (honducompras.gob.hn no responde desde fuera): se cargan los archivos anuales del OCP Data Registry; recargar cada mes.',
    'Sólo 1 de cada 5 adjudicaciones trae monto: se usa el contrato ligado o cantidad × precio de los ítems (cuadra con el contrato en el 94 % de lo medido); el piso es un filtro grueso.',
    'Las instituciones no tienen RTN en el OCDS: se reconocen sólo por nombre; las siglas solas («SESAL») no bastan.',
    'Sin tamaño oficial (trabajadores) en SellUp; web para ~440 RTN (directorio de HonduCompras).',
    'La prueba es el PDF del contrato en h1.honducompras.gob.hn, que puede no abrir desde fuera de Honduras.',
  ],
  riskNotes: [
    'Fuera personas naturales (RTN sin el 9 de persona jurídica), consorcios y entidades del Estado (por nombre).',
    'Nunca se guardan personas, contactos, cuentas ni el texto de las compras: sólo el resumen institución × proveedor.',
  ],
};

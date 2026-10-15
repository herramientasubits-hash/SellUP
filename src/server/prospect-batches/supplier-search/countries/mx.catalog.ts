/**
 * México — entrada del Catálogo de fuentes de Compras MX en «Proveedores de una empresa».
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { MX_COMPRASMX_SOURCE_KEY } from './mx';
import { MX_COMPRASMX_OPEN_DATA_PAGE } from './mx.loader';

export const MX_COMPRASMX_CATALOG_SOURCE: CatalogSource = {
  key: MX_COMPRASMX_SOURCE_KEY,
  name: 'Compras MX — contratos de la Administración Pública Federal («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_snapshot',
  nextAction:
    'Conectada en el código (AGENT1-SUPPLIER-SEARCH-MX-1) sólo para «Proveedores de una empresa» en México. Falta: (1) que la dueña apruebe la tabla partida del gasto → industria (BORRADOR, mx-partida-macro-table.ts) y (2) la carga del resumen (scripts/source-catalog/run-public-procurement-load.ts --country MX --end 2026-9 --months 12 --apply) con los CSV bajados a mano. Sin carga, el paso no reconoce ninguna entidad y sigue sólo Claude.',
  countryCodes: ['MX'],
  sectors: [],
  priority: 'P2',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: MX_COMPRASMX_OPEN_DATA_PAGE,
  automationLevel: 'low',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: con la referencia reconocida entre las instituciones compradoras cargadas (nombre o siglas: «IMSS», «ISSSTE», «SICT», «SEDENA»…), se leen sus proveedores empresa con al menos MXN 185 mil en contratos firmados en la ventana, filtrados por la industria pedida según la partida del gasto de lo que más le venden a ESA institución (regla del 50 %). Medido el 15-10-2026 (12 meses hasta sep-2026, dry-run): 10.306 pares institución × proveedor, 644 instituciones, 4.261 empresas medianas o grandes; 94 % con industria. IMSS × Salud: 437 proveedores (Infra, GE Sistemas Médicos, Baxter, Vitalmex, Boehringer Ingelheim, Janssen…).',
  limitations: [
    'Descarga A MANO: el portal firma cada descarga en el navegador (protección antibots) y no se imita desde un script. Un CSV por año (2025: 150 MB, 2026: 97 MB, latin-1); la recarga necesita que alguien baje el archivo del año en curso.',
    'Contratos de la Administración Pública Federal y de algunos gobiernos estatales y universidades que usan Compras MX; la mayoría de estados y municipios compran por sus propios portales.',
    'Sólo la partida del gasto (sin UNSPSC ni CUCOP por ítem): el monto de un contrato con varias partidas se reparte en partes iguales. La 339 (servicios integrales) cuenta como Salud sólo cuando la compra un ramo de salud (Salud, IMSS, ISSSTE, IMSS-Bienestar); subsidios, viáticos, eventos y equipo de defensa no clasifican.',
    'El tamaño es la estratificación que el proveedor declara en Compras MX: se descartan MICRO y PEQUEÑA (hasta 50 trabajadores); puede estar desactualizada.',
    'Sin web ni trabajadores por RFC en SellUp: casi todos los proveedores pasan por el rescate (costo).',
    'Compras consolidadas de medicamentos (IMSS-Bienestar, Birmex) concentran montos muy altos en pocos contratos.',
  ],
  riskNotes: [
    'Nunca se guardan personas, contactos, cuentas ni el texto de los contratos: sólo el resumen institución × proveedor.',
    'Fuera personas físicas (RFC de 13), extranjeros con RFC genérico, entidades públicas y empresas de participación estatal (Birmex, Alimentación para el Bienestar, Agroasemex, IEPSA…).',
    'Tabla public_procurement_supplier_links sólo para service_role (RLS sin políticas).',
  ],
};

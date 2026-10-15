/**
 * Ecuador — entrada del Catálogo de fuentes de SERCOP para «Proveedores de una empresa».
 * Mediciones del 15-10-2026 (dry-run del cargador, ventana oct-2025 → sep-2026).
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { EC_SERCOP_SOURCE_KEY } from './ec';

export const EC_CATALOG_SOURCE: CatalogSource = {
  key: EC_SERCOP_SOURCE_KEY,
  name: 'SERCOP — adjudicaciones de compras públicas (OCDS) («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_snapshot',
  nextAction:
    'Conectada en el código (AGENT1-SUPPLIER-SEARCH-ALL-1) sólo para «Proveedores de una empresa» en Ecuador. Necesita la carga del resumen (scripts/source-catalog/run-public-procurement-load.ts --country EC, 12 meses; dry-run 15-10-2026: 15.331 pares ≥ US$10.000, 1.813 entidades, 5.482 proveedores, ~11 MB). Sin carga, el paso no reconoce ninguna entidad y sigue sólo Claude.',
  countryCodes: ['EC'],
  sectors: [],
  priority: 'P1',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/datos-abiertos',
  automationLevel: 'medium',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: con la referencia reconocida entre las entidades compradoras cargadas (una por RUC; «MATRIZ» / «PLANTA CENTRAL» fuera del nombre, así «Ministerio de Salud Pública» es la matriz y no sus coordinaciones zonales), se leen sus proveedores sociedad privada (RUC con 3.er dígito 9) con al menos US$10.000 adjudicados en la ventana. Como SERCOP no publica la clasificación de lo comprado, la industria del proveedor sale de su ACTIVIDAD oficial (CIIU 4.0 INEC de la SCVS o del SRI) con la tabla CIIU → macro ya aprobada (decisión de la dueña 15-10-2026); medido: ~96 % de los proveedores tienen una macro. Tamaño con los trabajadores de la SCVS; web del directorio SCVS o de la lista curada. Cada candidato lleva «Proveedor de X» con la página pública del procedimiento en SERCOP como prueba.',
  limitations: [
    'Sin consulta en vivo: la API de búsqueda de SERCOP respondió «Too Many Requests» siempre; se carga el zip anual de datos abiertos.',
    'Hay que recargar cada mes (el zip del año en curso crece cada día).',
    'La industria es la de la actividad registrada del proveedor, no la de lo que le vende a la entidad: un distribuidor general puede caer en Comercio aunque venda medicinas.',
    'Un ministerio tiene varios RUC (matriz, zonales, distritos): cada uno es una entidad distinta.',
    'Montos de catálogo electrónico y adjudicaciones: un techo aproximado, no gasto ejecutado.',
  ],
  riskNotes: [
    'Nunca se guardan personas naturales (RUC con 3.er dígito 0–5), contactos ni el texto de los procesos: sólo el resumen comprador × proveedor.',
    'Tabla public_procurement_supplier_links sólo para service_role (RLS sin políticas).',
  ],
};

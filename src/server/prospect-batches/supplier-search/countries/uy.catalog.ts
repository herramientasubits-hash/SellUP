/**
 * Uruguay — entrada del Catálogo de fuentes de las adjudicaciones de ARCE en «Proveedores de una empresa».
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { UY_ARCE_AWARDS_SOURCE_KEY } from './uy';

export const UY_ARCE_AWARDS_CATALOG_SOURCE: CatalogSource = {
  key: UY_ARCE_AWARDS_SOURCE_KEY,
  name: 'ARCE — adjudicaciones OCDS por organismo («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_snapshot',
  nextAction:
    'Conectada en el código (AGENT1-SUPPLIER-SEARCH-ALL-1) sólo para «Proveedores de una empresa» en Uruguay, con la tabla del catálogo SICE ya aprobada (13-10-2026). Falta la carga del resumen (scripts/source-catalog/run-public-procurement-load.ts --country UY --end 2025-12 --months 12 --apply, con autorización). Sin carga, el paso no reconoce ninguna entidad y sigue sólo Claude.',
  countryCodes: ['UY'],
  sectors: [],
  priority: 'P2',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: 'https://catalogodatos.gub.uy/dataset/arce-datos-historicos-de-compras',
  automationLevel: 'medium',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: con la referencia reconocida entre los organismos compradores (inciso presupuestal: ministerio, ASSE, ente autónomo, intendencia), se leen sus proveedores empresa con al menos UYU 400 mil adjudicados en el año, filtrados por la industria pedida según la clase SICE de lo que más le venden a ESE organismo (tabla aprobada, regla del 50 %). Medido el 15-10-2026 (año 2025, dry-run): 8.008 pares organismo × proveedor, 62 organismos, 4.561 empresas; ASSE: 838 proveedores (Gador, GSK, Megalabs, Roche…). Prueba: el acta de adjudicación en comprasestatales.gub.uy. Web en SellUp para ~12 % de los proveedores (uy_arce_directory; muestra de 381).',
  limitations: [
    'Rezago: el último año publicado es 2025 (19-01-2026); 2026 no existe todavía y la URL de cada año hay que agregarla a mano (recurso CKAN propio).',
    'El comprador es la unidad ejecutora sin RUT: se agrupa en su inciso con una tabla fija de nombres (los hospitales de ASSE cuentan como ASSE).',
    'Sin monto de adjudicación: se usa cantidad × precio unitario por ítem, con cambios fijos (US$ 40, € 43,2, UI 6); los medicamentos pueden inflarse.',
    'Ítems con «x_ODG» (objeto del gasto) no tienen clase SICE: cuentan en el monto pero no clasifican.',
    'Un RUT puede ser de una empresa unipersonal: el OCDS no lo distingue.',
    'Sin trabajadores: ninguna fuente uruguaya de empresas cargada los trae.',
  ],
  riskNotes: [
    'Nunca se guardan personas, contactos, cuentas ni el texto de las adjudicaciones: sólo el resumen organismo × proveedor.',
    'Fuera cédulas (C/), extranjeros (X/) y entes del Estado; sólo RUT con dígito verificador válido.',
    'Tabla public_procurement_supplier_links sólo para service_role (RLS sin políticas).',
  ],
};

/**
 * Costa Rica — entrada del Catálogo de fuentes de SICOP para «Proveedores de una empresa».
 * Mediciones del 15-10-2026 (dry-run del cargador, ventana oct-2025 → sep-2026).
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { CR_SICOP_SOURCE_KEY } from './cr';

export const CR_CATALOG_SOURCE: CatalogSource = {
  key: CR_SICOP_SOURCE_KEY,
  name: 'SICOP — adjudicaciones de concursos (datos abiertos) («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_snapshot',
  nextAction:
    'Conectada en el código (AGENT1-SUPPLIER-SEARCH-ALL-1) sólo para «Proveedores de una empresa» en Costa Rica. Necesita la carga del resumen (scripts/source-catalog/run-public-procurement-load.ts --country CR, 12 meses; arma solo el índice de nombres del registro con --env-dir). Dry-run 15-10-2026: 5.525 pares ≥ CRC 4,5 millones, 295 instituciones, 1.885 proveedores, ~3 MB. Sin carga, el paso no reconoce ninguna entidad y sigue sólo Claude.',
  countryCodes: ['CR'],
  sectors: [],
  priority: 'P2',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: 'https://www.sicop.go.cr/moduloBid/report/RE_DatosAbiertosConcursosView.jsp',
  automationLevel: 'medium',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: con la referencia reconocida entre las instituciones compradoras cargadas (por nombre: SICOP no publica su cédula), se leen sus proveedores empresa con al menos CRC 4,5 millones (≈ US$10.000) adjudicados en la ventana. SICOP no trae la cédula del adjudicatario: se cruza su razón social con el registro de Costa Rica (cr_company_registry + alias) sólo si termina en forma societaria y el núcleo del nombre da UNA sola cédula de empresa (o la cédula viene escrita en el nombre); medido: 70 % de las líneas adjudicadas y 74 % de los pares sobre el piso encuentran cédula, 0,1 % son ambiguas y se descartan, y casi todo el resto son personas físicas o empresas extranjeras. La industria sale de la ACTIVIDAD oficial (CIIU del MEIC con la tabla aprobada para Costa Rica, o la macro ya aprobada del directorio gratuito; decisión de la dueña 15-10-2026); medido: ~88 % de los proveedores tienen una. Casi ninguno trae web en nuestras fuentes (3 %): van a Descartadas para que el rescate de Claude busque el sitio.',
  limitations: [
    'Sin cédula en la fuente: un proveedor cuyo nombre no está en el registro (o es ambiguo) no entra.',
    'Sin consulta en vivo: se baja el CSV mensual (≤ 1 mes por petición) y hay que recargar cada mes.',
    'Sin fecha por línea ni enlace público por procedimiento: la prueba es el número de procedimiento de SICOP.',
    'La industria es la de la actividad registrada del proveedor, no la de lo que le vende a la institución.',
    'Los montos «según demanda» son techos del acuerdo, no gasto ejecutado.',
  ],
  riskNotes: [
    'Nunca se guardan personas físicas (sin forma societaria no se cruzan), contactos ni el texto de los concursos: sólo el resumen institución × proveedor.',
    'Tabla public_procurement_supplier_links sólo para service_role (RLS sin políticas).',
  ],
};

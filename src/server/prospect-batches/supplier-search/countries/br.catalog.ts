/**
 * Brasil — entrada del Catálogo de fuentes de las compras públicas de «Proveedores de una
 * empresa» (AGENT1-SUPPLIER-SEARCH-ALL-1). Medida en vivo el 15-10-2026.
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { BR_PUBLIC_PROCUREMENT_SOURCE_KEY } from './br';

export const BR_PUBLIC_PROCUREMENT_CATALOG_SOURCE: CatalogSource = {
  key: BR_PUBLIC_PROCUREMENT_SOURCE_KEY,
  name: 'Compras.gov.br + PNCP — proveedores de una entidad pública («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_signal',
  nextAction:
    'Construida (AGENT1-SUPPLIER-SEARCH-ALL-1), pendiente de validar en Producción. Cuando la referencia es una entidad pública brasileña, consulta EN VIVO sus contratos de los últimos 12 meses antes de pagar a Claude: órgãos federales por Compras.gov.br dados abertos (ítems con CATMAT/CATSER) y estados/municipios por el PNCP. Medido el 15-10-2026: Ministério da Saúde × Tecnología 10 proveedores en 6 s, × Salud 53 en 8 s; Município de Campinas (PNCP) × Tecnología 7 en 5 s, × Salud 30 en 40 s. La tabla CATMAT/CATSER → industria la aprobó la dueña el 15-10-2026.',
  countryCodes: ['BR'],
  sectors: [],
  priority: 'P1',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: 'https://dadosabertos.compras.gov.br/',
  automationLevel: 'high',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: si la referencia coincide de forma única con una entidad pública de la Receita (natureza jurídica 1xxx; «Prefeitura de X» = «MUNICIPIO DE X»), se leen sus proveedores CNPJ de los últimos 12 meses con al menos R$ 55 mil acumulados (~US$10 mil), juntando filiales en su matriz. Industria por lo que le venden a ESA entidad (clase CATMAT/CATSER, regla del 50 %) y, sin catálogo (PNCP), por la actividad CNAE del proveedor en la Receita (tabla aprobada). Fuera personas físicas y entidades públicas. Web por CNPJ de la Receita; sin web, a Descartadas para que el rescate de Claude busque su sitio. Cada candidato lleva «Proveedor de X» con la página del contrato en el PNCP como prueba.',
  limitations: [
    'Sólo entidades públicas brasileñas con nombre único en la Receita (exacto o por el comienzo): «Secretaria de Estado da Saúde» existe en cada estado y no corre.',
    'Compras.gov.br lee hasta 24 páginas de 500 ítems repartidas en el año (el Ministério da Saúde tiene 66): en los órgãos más grandes es una muestra.',
    'El PNCP tarda 10–30 s por página: se leen como mucho 3 páginas de 500 contratos y el paso se corta a los 40 s; su filtro de fechas es por publicación.',
    'Sólo se buscan en el catálogo hasta 120 ítems por corrida (los de más monto de cada proveedor); el resto se clasifica por su CNAE.',
    'Preselección: los 20 de más monto y los que la Receita pone en la industria pedida; un proveedor fuera de la Receita y fuera del top 20 no se mira.',
    '`valorGlobal` del PNCP incluye empenhos y contratos plurianuales: el monto es indicativo.',
  ],
  riskNotes: [
    'Nunca se piden ni se guardan personas, contactos ni el texto de los contratos: sólo CNPJ, nombre, monto, fecha, código del ítem y el enlace al contrato.',
    'Sin llave ni registro: APIs públicas de dados abertos (Compras.gov.br) y del PNCP.',
    'Fundaciones y empresas estatales (natureza 2xxx/3xxx, p. ej. economía mixta) sí pasan como proveedoras; sólo la natureza 1xxx se excluye.',
  ],
};

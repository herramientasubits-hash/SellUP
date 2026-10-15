/**
 * Estados Unidos — entrada del Catálogo de fuentes de las compras públicas de «Proveedores
 * de una empresa» (AGENT1-SUPPLIER-SEARCH-ALL-1). Medida en vivo el 15-10-2026.
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { US_USASPENDING_SOURCE_KEY } from './us';

export const US_PUBLIC_PROCUREMENT_CATALOG_SOURCE: CatalogSource = {
  key: US_USASPENDING_SOURCE_KEY,
  name: 'USAspending.gov — proveedores de una agencia federal («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_signal',
  nextAction:
    'Construida (AGENT1-SUPPLIER-SEARCH-ALL-1), pendiente de validar en Producción. Cuando la referencia es una agencia federal de EE. UU., consulta EN VIVO en USAspending API v2 sus contratos (tipos A–D) de los últimos 12 meses antes de pagar a Claude. Medido el 15-10-2026: VA × Tecnología, Army × Salud, DHS × Servicios y GSA × Tecnología, 40 proveedores leídos y 30–35 en la industria en 1,4–2,5 s cada una. La tabla NAICS → industria es BORRADOR hasta que la apruebe la dueña.',
  countryCodes: ['US'],
  sectors: [],
  priority: 'P1',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: 'https://api.usaspending.gov/',
  automationLevel: 'high',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: si la referencia coincide de forma única con una agencia federal de USAspending (toptier o subtier; «Department of the Army» = «Army»), se leen sus 100 proveedores de más monto en los NAICS de la industria pedida (piso US$100 mil en 12 meses) y, de los 40 primeros, sus contratos con la agencia: la industria es la de lo que más le venden (NAICS, regla del 50 %) y la prueba su contrato más grande. Fuera gobiernos (categoría «government»: estados, condados, ciudades, universidades públicas) y nombres que no son empresa. El UEI no está en ninguna fuente de SellUp: web y empleados (990) por nombre en el directorio gratuito; sin web, a Descartadas para que el rescate de Claude busque su sitio.',
  limitations: [
    'Sólo agencias federales (USAspending no cubre compras de estados y municipios).',
    'El cruce por nombre con el directorio gratuito es bajo: 5 de 68 proveedores medidos (IBM, SAIC, Viasat, GEO Group; 4 con web). Casi todos van al rescate de Claude por su web.',
    'La industria usa el monto total de los contratos con actividad en la ventana (hasta 100 por cada 10 proveedores); la fecha mostrada es el inicio del contrato más reciente de esos, que puede ser anterior a la ventana.',
    'Una subagencia que no adjudica contratos (p. ej. «Veterans Health Administration»: los contratos van a nombre del VA) no trae proveedores.',
    'Industrias sin NAICS en la tabla (Gobierno) no consultan.',
  ],
  riskNotes: [
    'API pública sin llave ni registro; sólo lectura.',
    'Nunca se guardan personas ni contactos: sólo UEI, nombre, montos, NAICS y el enlace al contrato en usaspending.gov. Los receptores «REDACTED DUE TO PII» se descartan.',
    'El UEI no es un número fiscal: los candidatos llevan tipo de identificador «other».',
  ],
};

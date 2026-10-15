/**
 * República Dominicana — entrada del Catálogo de fuentes de la API de datos abiertos de
 * la DGCP para «Proveedores de una empresa» (AGENT1-SUPPLIER-SEARCH-ALL-1). Nunca
 * `connected`.
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { DO_DGCP_SUPPLIERS_SOURCE_KEY } from './do';

export const DO_PROCUREMENT_CATALOG_SOURCE: CatalogSource = {
  key: DO_DGCP_SUPPLIERS_SOURCE_KEY,
  name: 'DGCP (Compras Dominicana) — contratos de una unidad de compra, en vivo («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_signal',
  nextAction:
    'Conectada en el código (AGENT1-SUPPLIER-SEARCH-ALL-1) sólo para «Proveedores de una empresa» en República Dominicana: consulta en vivo los contratos de la unidad de compra (12 meses) antes de pagar a Claude. Probada en vivo el 15-10 (sólo lectura): Servicio Nacional de Salud × Salud = 12 proveedores con RNC en 5,2 s; Ministerio de Salud Pública × Tecnología = 3 en 5,0 s. Falta verla en una corrida real en Producción.',
  countryCodes: ['DO'],
  sectors: [],
  priority: 'P1',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: 'https://datosabiertos.dgcp.gob.do/api-dgcp/v1',
  automationLevel: 'high',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: con la referencia reconocida entre las unidades de compra activas de la DGCP (nombre o acrónimo), se leen sus contratos no cancelados de los últimos 12 meses, se agrupan por proveedor con al menos DOP 600 mil (~US$10 mil), el RNC sale de do_dgcp (sin RNC de sociedad ⇒ persona física, fuera) y la industria de las familias UNSPSC que el proveedor declara en el Registro de Proveedores (tabla aprobada, regla del 50 %). Web del registro DGII (do_dgii_size_registry). Cada candidato lleva «Proveedor de X» con la página del contrato en Compras Dominicana como prueba.',
  limitations: [
    'Límite de la API: 60 peticiones por minuto por IP (429 al pasarse). Cada corrida usa ≤ 3 páginas de contratos y ≤ 40 consultas de rubro; ante el primer error responde con lo ya clasificado.',
    'La industria es la DECLARADA por el proveedor (rubro), no la de lo que le vendió a esa entidad: la API no filtra los artículos por contrato ni por entidad. Los que declaran de todo (p. ej. 84 familias) no se clasifican; una constructora que declara equipo de laboratorio puede salir en Salud.',
    'Sólo se clasifican los 40 de más monto: en entidades grandes la industria pedida puede quedar con pocos o ningún proveedor.',
    'RNC por el rpe de do_dgcp (151 de 163 en el Ministerio de Salud Pública): un proveedor inscrito después de esa carga no entra.',
    'Web en 1.529 de 12.931 filas del registro DGII: el resto va a Descartadas para el rescate de Claude.',
  ],
  riskNotes: [
    'Sólo GET a la API pública con User-Agent; no se guardan contactos, correos ni teléfonos del Registro de Proveedores (no se piden).',
    'Las otras entidades públicas quedan fuera por nombre de unidad de compra.',
  ],
};

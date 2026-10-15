/**
 * Argentina — entrada del Catálogo de fuentes de COMPR.AR en «Proveedores de una empresa».
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { AR_COMPRAR_SOURCE_KEY } from './ar';
import { AR_COMPRAR_ADJUDICATIONS_URL } from './ar.loader';

export const AR_COMPRAR_CATALOG_SOURCE: CatalogSource = {
  key: AR_COMPRAR_SOURCE_KEY,
  name: 'COMPR.AR — adjudicaciones de la Administración Pública Nacional («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_snapshot',
  nextAction:
    'Conectada en el código (AGENT1-SUPPLIER-SEARCH-ALL-1) sólo para «Proveedores de una empresa» en Argentina. Falta: (1) que la dueña apruebe la tabla Rubro COMPR.AR → industria (BORRADOR, ar-rubro-macro-table.ts) y (2) la carga del resumen (scripts/source-catalog/run-public-procurement-load.ts --country AR --end 2026-7 --months 12 --apply). Sin carga, el paso no reconoce ninguna entidad y sigue sólo Claude.',
  countryCodes: ['AR'],
  sectors: [],
  priority: 'P2',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: AR_COMPRAR_ADJUDICATIONS_URL,
  automationLevel: 'medium',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: con la referencia reconocida entre los organismos compradores cargados (SAF, p. ej. «Ministerio de Salud»), se leen sus proveedores empresa con al menos ARS 15 millones adjudicados en la ventana, filtrados por la industria pedida según los rubros de COMPR.AR de lo que más le venden a ESE organismo (regla del 50 %). Medido el 15-10-2026 (12 meses hasta jul-2026, dry-run): 3.016 pares organismo × proveedor, 101 organismos, 1.618 empresas; Ministerio de Salud: 61 proveedores (Novartis, Gador, Sinergium, Pfizer, Abbott, Takeda…). Web en SellUp para ~31 % de los proveedores (RNS, ATP, lista curada; muestra de 407).',
  limitations: [
    'Sólo Administración Pública Nacional: provincias y municipios compran por otros portales.',
    'Sin consulta en vivo: un solo CSV de 88 MB con refresco SEMESTRAL (último 03-08-2026, llega a 09-07-2026).',
    'Sólo rubros gruesos de COMPR.AR (49), varios por línea: el monto se reparte en partes iguales. EQUIPOS, ALQUILER, CEREMONIAL, CULTURA y CONCESION no clasifican (18 % de los pares queda sin industria).',
    'El mayor volumen es de Defensa y Seguridad (Ejército, Armada, Fuerza Aérea, Gendarmería); Salud compra poco por COMPR.AR.',
    'Un cuarto de los CUIT viene con 12 dígitos (verificador repetido): se corrigen sólo si el CUIT de 11 es válido.',
    'Sin enlace público por orden de compra: la prueba es el número de documento contractual (p. ej. 80-1131-OC21).',
    'Montos nominales en pesos con 12 meses de inflación; las monedas extranjeras pasan a pesos con un cambio fijo aproximado.',
    'Sin trabajadores: ninguna fuente argentina cargada los trae.',
  ],
  riskNotes: [
    'Nunca se guardan personas, contactos, cuentas ni el texto de las órdenes: sólo el resumen organismo × proveedor.',
    'Fuera personas físicas (CUIT 20/23/24/27), organismos públicos y las sociedades del Estado de la capa de Gobierno.',
    'Tabla public_procurement_supplier_links sólo para service_role (RLS sin políticas).',
  ],
};

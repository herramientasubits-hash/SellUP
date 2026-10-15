/**
 * España — entrada del Catálogo de fuentes de las adjudicaciones de la PLACSP en «Proveedores de una empresa».
 */

import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import { ES_PLACSP_AWARDS_SOURCE_KEY } from './es';

export const ES_PLACSP_AWARDS_CATALOG_SOURCE: CatalogSource = {
  key: ES_PLACSP_AWARDS_SOURCE_KEY,
  name: 'PLACSP — adjudicaciones por entidad contratante («Proveedores de una empresa»)',
  sellupUse: 'enrichment',
  aiFlowStatus: 'connected_free_discovery',
  connectionMode: 'read_only_snapshot',
  nextAction:
    'Conectada en el código (AGENT1-SUPPLIER-SEARCH-ALL-1) sólo para «Proveedores de una empresa» en España, con la tabla CPV → industria ya aprobada (13-10-2026). Falta la carga del resumen: bajar los 12 zips mensuales con curl -k (la cadena TLS de la PLACSP no valida) a ~/Documents/SellUp-data/public-procurement/es/ y correr scripts/source-catalog/run-public-procurement-load.ts --country ES --end <último mes> --months 12 --apply (con autorización). Sin carga, el paso no reconoce ninguna entidad y sigue sólo Claude.',
  countryCodes: ['ES'],
  sectors: [],
  priority: 'P2',
  operationalStatus: 'pending_validation',
  type: 'procurement',
  url: 'https://contrataciondelestado.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom',
  automationLevel: 'medium',
  recommendedUse:
    'Sólo para «Proveedores de una empresa»: con la referencia reconocida entre las entidades contratantes cargadas (por NIF; sus órganos —Alcaldía, Junta de Gobierno, Áreas— se agrupan con el nombre de la entidad, p. ej. «Ayuntamiento de Madrid»), se leen sus proveedores empresa con al menos € 10.000 adjudicados en la ventana, filtrados por la industria pedida según la división CPV de lo que más le adjudican a ESA entidad (tabla aprobada, regla del 50 %). Prueba: la ficha de la licitación en la Plataforma. Medido el 15-10-2026 (12 meses oct-2025 → sep-2026, dry-run): 69.801 pares entidad × proveedor, 5.119 entidades, 25.194 empresas, 47 MB, 2 min 22 s de lectura (2,3 GB de zips, ~25 min de descarga con 6 conexiones); Complejo Hospitalario Universitario Insular Materno Infantil: 364 proveedores (Janssen, Gilead, Roche, Novartis, MSD, Pfizer…); Ayuntamiento de Madrid: 468.',
  limitations: [
    'Sin consulta en vivo: zips mensuales de 150-300 MB (≈ 2,5-3 GB al año), lentos de bajar (~8 MB/min por conexión) y con certificado TLS que no valida.',
    'Sólo la sindicación 643 (Plataforma estatal y perfiles alojados): las plataformas autonómicas agregadas (sindicación 1044) y los contratos menores (1143) quedan fuera.',
    'El monto es el adjudicado sin IVA por lote (puede ser un acuerdo marco o un contrato plurianual, no gasto anual).',
    'Educación (CPV 80) y otras divisiones sin macro en la tabla no clasifican.',
    'Casi sin web en SellUp: en una muestra de 420 proveedores, 346 están en los registros de NIF pero NINGUNO trae web ni trabajadores ⇒ van a Descartadas y el rescate de Claude busca el sitio (cuesta).',
    'Volumen como Chile (~70 mil pares con piso € 10.000); con piso € 50.000 serían 43.507 y con € 100.000, 29.830.',
  ],
  riskNotes: [
    'Nunca se guardan personas, contactos, cuentas ni el texto de los pliegos: sólo el resumen entidad × proveedor.',
    'Fuera DNI/NIE, UTE, asociaciones/fundaciones y organismos públicos (NIF P/Q/S); sólo NIF de sociedad con control válido.',
    'Tabla public_procurement_supplier_links sólo para service_role (RLS sin políticas).',
  ],
};

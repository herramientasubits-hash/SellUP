/**
 * ve-official-workforce.ts — trabajadores publicados por empresa en Venezuela, para
 * el tamaño de la ficha.
 *
 * SOURCES-VE-SIZE-1 (14-10-2026, pedido de la dueña). Puro: sin env, sin I/O, sin DB.
 *
 * Venezuela no publica tamaño por empresa (el SENIAT no publica la lista de
 * contribuyentes especiales). Lo único medido con número:
 *
 *   1. SUDEBAN — Boletín Mensual, hoja «Número de oficinas y trabajadores … según
 *      banco», cifras al 30-06-2022 (copia del Internet Archive: el sitio no responde
 *      desde fuera del país). Oficial. 13 de sus 26 entidades están en la capa gratuita.
 *   2. Great Place to Work Venezuela — empleados que declara cada empresa certificada
 *      en su ranking (2023-2026). No es oficial: sólo para empresas que SUDEBAN no
 *      cubre (4).
 *
 *   3. ONAPRE — cargos presupuestados de órganos y entes públicos (Ley de Presupuesto
 *      2016, `ve-onapre-posts.ts`), por el dominio de la entidad (SOURCES-VE-SIZE-2).
 *
 * SUDEASEG no publica empleados por aseguradora: las 15 mayores por primas llevan un
 * tramo «grande» aparte (`ve-insurer-premiums.ts`).
 * Una empresa que no está aquí sigue sin tamaño oficial: lo pone el proveedor.
 */

import { VE_ONAPRE_POSTS, VE_ONAPRE_POSTS_YEAR } from './ve-onapre-posts';

export type VeWorkforceSource = 'sudeban' | 'gptw' | 'onapre';

export type VeOfficialWorkforce = {
  /** RIF de la fila (registro y capa gratuita con RIF). */
  rif: string | null;
  /** Dominio de la fila sólo con web (capa gratuita sin RIF). */
  domain: string | null;
  name: string;
  workers: number;
  year: number;
  source: VeWorkforceSource;
};

/** Etiqueta de cada fuente para la ficha. */
export const VE_WORKFORCE_SOURCE_LABEL: Readonly<Record<VeWorkforceSource, string>> = {
  sudeban: 'SUDEBAN (Boletín Mensual, jun-2022)',
  gptw: 'Great Place to Work Venezuela',
  onapre: 'ONAPRE (cargos de la Ley de Presupuesto 2016)',
};

export const VE_OFFICIAL_WORKFORCE: readonly VeOfficialWorkforce[] = Object.freeze([
  // ── SUDEBAN, trabajadores totales al 30-06-2022 ──
  { rif: 'G-20009997-6', domain: null, name: 'Banco de Venezuela', workers: 7104, year: 2022, source: 'sudeban' },
  { rif: 'J-07013380-5', domain: null, name: 'Banesco', workers: 3138, year: 2022, source: 'sudeban' },
  { rif: null, domain: 'mercantilbanco.com', name: 'Mercantil Banco', workers: 2552, year: 2022, source: 'sudeban' },
  { rif: 'G-20005187-6', domain: null, name: 'Banco del Tesoro', workers: 2059, year: 2022, source: 'sudeban' },
  { rif: 'J-00002967-9', domain: null, name: 'Banco Provincial', workers: 1693, year: 2022, source: 'sudeban' },
  { rif: 'J-30984132-7', domain: null, name: 'Banco Nacional de Crédito', workers: 1580, year: 2022, source: 'sudeban' },
  { rif: 'J-00002949-0', domain: null, name: 'Bancaribe', workers: 942, year: 2022, source: 'sudeban' },
  { rif: 'J-00002970-9', domain: null, name: 'Venezolano de Crédito', workers: 909, year: 2022, source: 'sudeban' },
  { rif: 'J-00002950-4', domain: null, name: 'Banco Exterior', workers: 818, year: 2022, source: 'sudeban' },
  { rif: 'J-31628759-9', domain: null, name: 'Bancamiga', workers: 689, year: 2022, source: 'sudeban' },
  { rif: 'J-00042303-2', domain: null, name: 'Banplus', workers: 681, year: 2022, source: 'sudeban' },
  { rif: 'J-00072306-0', domain: null, name: 'Banco Fondo Común', workers: 581, year: 2022, source: 'sudeban' },
  { rif: 'J-09028384-6', domain: null, name: 'Banco Sofitasa', workers: 351, year: 2022, source: 'sudeban' },
  // ── Great Place to Work Venezuela (lo que SUDEBAN no cubre) ──
  { rif: 'J-30108335-0', domain: null, name: 'Netuno', workers: 1198, year: 2026, source: 'gptw' },
  { rif: 'J-00021467-0', domain: null, name: 'Calox International', workers: 654, year: 2026, source: 'gptw' },
  { rif: 'J-30898736-0', domain: null, name: 'Empire Keeway', workers: 76, year: 2026, source: 'gptw' },
  { rif: 'J-31438468-6', domain: null, name: 'Capsuven Pharma Labs', workers: 35, year: 2024, source: 'gptw' },
]);

const BY_RIF: ReadonlyMap<string, VeOfficialWorkforce> = new Map(
  VE_OFFICIAL_WORKFORCE.filter((w) => w.rif !== null).map((w) => [w.rif!, w]),
);
const BY_DOMAIN: ReadonlyMap<string, VeOfficialWorkforce> = new Map(
  VE_OFFICIAL_WORKFORCE.filter((w) => w.domain !== null).map((w) => [w.domain!, w]),
);

const ONAPRE_BY_DOMAIN: ReadonlyMap<string, VeOfficialWorkforce> = new Map(
  VE_ONAPRE_POSTS.map((p) => [
    p.domain,
    { rif: null, domain: p.domain, name: p.name, workers: p.posts, year: VE_ONAPRE_POSTS_YEAR, source: 'onapre' as const },
  ]),
);

/**
 * Trabajadores publicados de una fila: por RIF, o por la web (bancos sin RIF y entes
 * públicos con cargos de la ONAPRE). `null` sin dato.
 */
export function veOfficialWorkforceFor(rif: string | null | undefined, domain: string | null | undefined): VeOfficialWorkforce | null {
  if (typeof rif === 'string' && BY_RIF.has(rif)) return BY_RIF.get(rif)!;
  if (typeof domain === 'string' && BY_DOMAIN.has(domain)) return BY_DOMAIN.get(domain)!;
  if (typeof domain === 'string' && ONAPRE_BY_DOMAIN.has(domain)) return ONAPRE_BY_DOMAIN.get(domain)!;
  return null;
}

/**
 * Campos de `raw_data` que leen la ficha (`workforceFromRawData`: `workers` +
 * `metrics_year`) y la capa gratuita (`workforce_source`). Vacío sin dato.
 */
export function veWorkforceRaw(entry: VeOfficialWorkforce | null): Record<string, unknown> {
  return entry === null ? {} : { workers: entry.workers, metrics_year: entry.year, workforce_source: entry.source };
}

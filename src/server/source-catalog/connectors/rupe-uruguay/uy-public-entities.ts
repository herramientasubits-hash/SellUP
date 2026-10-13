/**
 * uy-public-entities.ts — entidades del Estado uruguayo para la capa gratuita de
 * Gobierno (`uy_public_entities`), con su web .gub.uy y, cuando lo hay, su RUT.
 *
 * SOURCES-UY-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Fuente: «Referentes de transparencia activa y pasiva» de la UAIP (catalogodatos
 * .gub.uy, conjunto `uaip-responsables_transparencia_uaip`, 373 organismos): inciso,
 * unidad ejecutora, nombre corto (sigla) y grupo (Poder Ejecutivo, entes
 * autónomos, servicios descentralizados, gobiernos departamentales, personas
 * públicas no estatales…). De cada fila se usa SÓLO el organismo y el DOMINIO del
 * correo institucional: nunca el nombre, el teléfono ni el correo de la persona.
 *
 * Reglas:
 *   - Una entidad por inciso (ministerio, ente, UdelaR, ANEP…), no por dirección,
 *     facultad ni consejo: la facultad de Artes no es otra «empresa» que UdelaR.
 *   - Gobiernos departamentales y personas públicas no estatales (cuyo inciso es un
 *     cajón común): una entidad por unidad ejecutora (intendencia, junta, LATU…).
 *   - Las 19 intendencias también salen de una tabla fija con su web oficial
 *     (`UY_INTENDENCIAS`, comprobada el 13-10-2026): la UAIP no trae a todas.
 *   - Web: el dominio del correo sólo si su dirección NOMBRA a la entidad
 *     (`uruguayDomainNamesEntity`: sigla, iniciales o palabra distintiva).
 *   - RUT: el del RUPE si la entidad está inscrita como proveedora (lo busca el
 *     ETL por su nombre o por su sigla OFICIAL de `UY_PUBLIC_ENTITY_ACRONYMS`, nunca
 *     por la sigla libre de la UAIP: «MEF» es también MEF S.R.L. y «PJ» PJ Uruguay
 *     SAS); si no, la entidad se identifica por su web.
 *   - Sin web y sin RUT, la entidad no entra.
 *   - Tamaño oficial (SOURCES-UY-PUBLIC-ENTITY-SIZE-1, dueña 13-10-2026): los
 *     funcionarios del organismo según la ONSC («Evolución de vínculos con el
 *     Estado», catalogodatos.gub.uy, último corte 31-12-2020), sumando funcionarios
 *     públicos y no funcionarios. Sólo a la entidad que ES el inciso: un ministerio
 *     o ente, la intendencia (no su junta) y un organismo que es el único de su
 *     inciso. Nunca a una dirección, facultad, municipio ni junta, ni a la
 *     Defensoría del Pueblo con el total del Poder Legislativo. Mismo criterio que la
 *     dotación del INDEC en Argentina.
 */

import { buildRecordIdentityKey, type RecordIdentityKey } from '../../record-identity';
import { plainUpperUruguay, uruguayNameCore } from './uy-name-keys';
import { uruguayPublicEntityDomain } from './uy-domain';

export const UY_PUBLIC_ENTITIES_SOURCE_KEY = 'uy_public_entities' as const;
export const UY_PUBLIC_ENTITY_MACRO = 'government' as const;
export const UY_PUBLIC_ENTITY_IDENTITY_NAMESPACE = 'uy-public-entity' as const;

/** ¿Es la razón social la de una entidad del Estado (va a Gobierno, no a la capa de empresas)? */
const PUBLIC_ENTITY_START =
  /^(ADMINISTRACION NACIONAL|ADMINISTRACION DE (LAS|LOS|FERROCARRILES)|MINISTERIO|INTENDENCIA|JUNTA DEPARTAMENTAL|MUNICIPIO|BANCO DE LA REPUBLICA ORIENTAL|BANCO DE SEGUROS DEL ESTADO|BANCO DE PREVISION SOCIAL|BANCO HIPOTECARIO DEL URUGUAY|BANCO CENTRAL DEL URUGUAY|UNIVERSIDAD DE LA REPUBLICA|UNIVERSIDAD TECNOLOGICA|PODER (JUDICIAL|LEGISLATIVO|EJECUTIVO)|PRESIDENCIA DE LA REPUBLICA|CORTE ELECTORAL|TRIBUNAL DE (CUENTAS|LO CONTENCIOSO)|CONGRESO DE INTENDENTES|INSTITUTO NACIONAL DE (COLONIZACION|CARNES|INVESTIGACION AGROPECUARIA|EMPLEO|ESTADISTICA|INCLUSION|DE LA JUVENTUD)|INSTITUTO DEL NINO Y ADOLESCENTE|AGENCIA NACIONAL|UNIDAD REGULADORA|CORPORACION NACIONAL PARA EL DESARROLLO|ADMINISTRACION DE LOS SERVICIOS DE SALUD|CAJA DE JUBILACIONES Y PENSIONES BANCARIAS|DIRECCION NACIONAL|DIRECCION GENERAL IMPOSITIVA)\b/;

export function isUruguayPublicEntityName(name: string | null | undefined): boolean {
  return typeof name === 'string' && PUBLIC_ENTITY_START.test(plainUpperUruguay(name));
}

/** Una fila de la lista de la UAIP, reducida a lo que se usa (sin datos personales). */
export type UyTransparencyReferent = {
  inciso: string;
  incisoName: string;
  unit: string;
  unitName: string;
  shortName: string | null;
  group: string;
  /** Dominio del correo institucional (sólo el dominio). */
  emailDomain: string | null;
};

/** Una entidad pública ya agrupada. */
export type UyPublicEntity = {
  key: string;
  name: string;
  acronyms: string[];
  group: string;
  domain: string | null;
  /** Inciso cuyo total de funcionarios (ONSC) es el de ESTA entidad; `null` si ninguno. */
  onscInciso?: number | null;
};

const titleCase = (text: string): string =>
  text
    .toLowerCase()
    .replace(/(^|[\s(-])([a-záéíóúñü])/g, (_, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`)
    .replace(/\b(De|Del|La|Las|Los|El|Y|E|En|Para|Por|A|Al)\b/g, (w) => w.toLowerCase());

/**
 * Grupos que se agrupan por inciso (un ministerio, un ente): sus unidades son
 * direcciones, facultades o consejos del mismo organismo. El resto (gobiernos
 * departamentales, personas públicas no estatales, Poder Legislativo y Judicial,
 * órganos de control) va por unidad ejecutora: su inciso es un cajón común (la
 * Defensoría del Pueblo cuelga del inciso del Poder Legislativo).
 */
const INCISO_LEVEL_GROUPS: ReadonlySet<string> = new Set([
  'Poder Ejecutivo',
  'Entes autónomos',
  'Servicios descentralizados',
]);

/**
 * Las 19 intendencias con su web oficial (respuesta comprobada el 13-10-2026;
 * Lavalleja no publica dominio propio). La UAIP no trae a Montevideo, Maldonado ni
 * Río Negro con su correo institucional.
 */
export const UY_INTENDENCIAS: readonly { department: string; domain: string | null }[] = Object.freeze([
  { department: 'Artigas', domain: 'artigas.gub.uy' },
  { department: 'Canelones', domain: 'imcanelones.gub.uy' },
  { department: 'Cerro Largo', domain: 'cerrolargo.gub.uy' },
  { department: 'Colonia', domain: 'colonia.gub.uy' },
  { department: 'Durazno', domain: 'durazno.gub.uy' },
  { department: 'Flores', domain: 'flores.gub.uy' },
  { department: 'Florida', domain: 'florida.gub.uy' },
  { department: 'Lavalleja', domain: null },
  { department: 'Maldonado', domain: 'maldonado.gub.uy' },
  { department: 'Montevideo', domain: 'montevideo.gub.uy' },
  { department: 'Paysandú', domain: 'paysandu.gub.uy' },
  { department: 'Río Negro', domain: 'rionegro.gub.uy' },
  { department: 'Rivera', domain: 'rivera.gub.uy' },
  { department: 'Rocha', domain: 'rocha.gub.uy' },
  { department: 'Salto', domain: 'salto.gub.uy' },
  { department: 'San José', domain: 'sanjose.gub.uy' },
  { department: 'Soriano', domain: 'soriano.gub.uy' },
  { department: 'Tacuarembó', domain: 'tacuarembo.gub.uy' },
  { department: 'Treinta y Tres', domain: 'treintaytres.gub.uy' },
]);

/** Inciso presupuestal de cada gobierno departamental (80 Artigas … 98 Montevideo). */
export const UY_DEPARTMENT_INCISO: Readonly<Record<string, number>> = Object.freeze({
  Artigas: 80,
  Canelones: 81,
  'Cerro Largo': 82,
  Colonia: 83,
  Durazno: 84,
  Flores: 85,
  Florida: 86,
  Lavalleja: 87,
  Maldonado: 88,
  Paysandú: 89,
  'Río Negro': 90,
  Rivera: 91,
  Rocha: 92,
  Salto: 93,
  'San José': 94,
  Soriano: 95,
  Tacuarembó: 96,
  'Treinta y Tres': 97,
  Montevideo: 98,
});

/** Las intendencias de la tabla fija como entidades (la web ya está comprobada). */
export function uyIntendenciaEntities(): UyPublicEntity[] {
  return UY_INTENDENCIAS.map(({ department, domain }) => ({
    key: `intendencia:${department}`,
    name: `Intendencia Departamental de ${department}`,
    acronyms: [],
    group: 'Gobiernos departamentales y congreso de Intendentes',
    domain,
    onscInciso: UY_DEPARTMENT_INCISO[department] ?? null,
  }));
}

/**
 * Las entidades de la UAIP más las 19 intendencias, sin repetir: una intendencia de
 * la tabla reemplaza a la de la UAIP (misma razón social), conservando su web si
 * la UAIP no la trae.
 */
export function mergeUyPublicEntities(fromUaip: readonly UyPublicEntity[]): UyPublicEntity[] {
  const byName = new Map(fromUaip.map((entity) => [uruguayNameCore(entity.name), entity] as const));
  for (const intendencia of uyIntendenciaEntities()) {
    const core = uruguayNameCore(intendencia.name);
    const existing = byName.get(core);
    byName.set(core, { ...intendencia, domain: intendencia.domain ?? existing?.domain ?? null, key: existing?.key ?? intendencia.key });
  }
  return [...byName.values()];
}

/** «DGS - MDN» → [«DGS», «MDN»]; «INT ARTIGAS» → [«INT ARTIGAS»]. */
function shortNameAcronyms(shortName: string | null): string[] {
  if (shortName === null) return [];
  return shortName
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 20);
}

/**
 * Agrupa las filas de la UAIP en entidades: una por ministerio en el Poder
 * Ejecutivo, una por unidad ejecutora en el resto. La web es el primer dominio
 * de correo que nombra a la entidad.
 */
export function groupUyPublicEntities(referents: readonly UyTransparencyReferent[]): UyPublicEntity[] {
  const groups = new Map<
    string,
    { name: string; acronyms: Set<string>; group: string; domains: string[]; onscInciso: number | null }
  >();
  const unitsByInciso = new Map<string, Set<string>>();
  for (const r of referents) unitsByInciso.set(r.inciso, (unitsByInciso.get(r.inciso) ?? new Set<string>()).add(r.unit));
  for (const r of referents) {
    const executive = INCISO_LEVEL_GROUPS.has(r.group);
    const key = executive ? `inciso:${r.inciso}` : `ue:${r.inciso}-${r.unit}`;
    const name = titleCase(executive ? r.incisoName : r.unitName).trim();
    const entry = groups.get(key) ?? {
      name,
      acronyms: new Set<string>(),
      group: r.group,
      domains: [],
      onscInciso: onscIncisoFor(r, executive, unitsByInciso.get(r.inciso)?.size ?? 0),
    };
    const acronyms = shortNameAcronyms(r.shortName);
    // Por inciso, la sigla del organismo es la ÚLTIMA parte («DGS - MDN» → MDN), y
    // sólo la de las filas cuya unidad es el propio inciso o la más repetida.
    for (const a of executive ? acronyms.slice(-1) : acronyms) entry.acronyms.add(a);
    if (r.emailDomain) entry.domains.push(r.emailDomain);
    groups.set(key, entry);
  }
  return [...groups.entries()].map(([key, g]) => {
    const acronyms = [...g.acronyms];
    const domain = uruguayPublicEntityDomain({
      name: g.name,
      acronyms,
      emails: g.domains.map((d) => `x@${d}`),
    });
    return { key, name: g.name, acronyms, group: g.group, domain, onscInciso: g.onscInciso };
  });
}

/**
 * El inciso cuyo total de funcionarios es el de esta entidad: el ministerio o ente
 * agrupado por inciso; la intendencia (unidad 01 de un gobierno departamental, no la
 * junta); u otro organismo que es la única unidad de su inciso. Nunca el Poder
 * Legislativo (inciso 1), que reúne cámaras y la Defensoría del Pueblo.
 */
function onscIncisoFor(r: UyTransparencyReferent, incisoLevel: boolean, unitsInInciso: number): number | null {
  const inciso = Number(r.inciso);
  if (!Number.isInteger(inciso) || inciso <= 1) return null;
  if (incisoLevel) return inciso;
  if (/^GOBIERNO DEPARTAMENTAL/.test(plainUpperUruguay(r.incisoName))) {
    return r.unit === '01' && /^INTENDENCIA/.test(plainUpperUruguay(r.unitName)) ? inciso : null;
  }
  if (r.group === 'Personas públicas no estatales') return null;
  return unitsInInciso === 1 ? inciso : null;
}

/** Funcionarios de un inciso según la ONSC y el año del corte. */
export type UyOnscHeadcount = { workers: number; year: number };

/**
 * Filas del CSV de la ONSC («Evolución de vínculos con el Estado»: número de inciso,
 * inciso, fecha, naturaleza del vínculo, cantidad) → funcionarios por inciso en el
 * ÚLTIMO corte, sumando funcionarios públicos y no funcionarios. Las columnas se leen
 * por posición (el archivo viene en latin-1 y sus cabeceras llegan con tildes rotas).
 */
export function parseUyOnscHeadcount(records: readonly Record<string, string>[]): Map<number, UyOnscHeadcount> {
  const rows = records
    .map((record) => Object.values(record))
    .map(([inciso, , date, , amount]) => ({
      inciso: Number((inciso ?? '').trim()),
      date: (date ?? '').trim().slice(0, 10),
      // Una celda vacía no es «0 funcionarios»: la fila no cuenta.
      amount: (amount ?? '').trim() === '' ? NaN : Number((amount ?? '').trim()),
    }))
    .filter((row) => Number.isInteger(row.inciso) && row.inciso > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.amount));
  const lastDate = rows.reduce((max, row) => (row.date > max ? row.date : max), '');
  const totals = new Map<number, UyOnscHeadcount>();
  for (const row of rows) {
    if (row.date !== lastDate) continue;
    const previous = totals.get(row.inciso)?.workers ?? 0;
    totals.set(row.inciso, { workers: previous + Math.round(row.amount), year: Number(lastDate.slice(0, 4)) });
  }
  return totals;
}

/** Orden dentro de Gobierno: entes y ministerios primero, juntas al final. */
const GROUP_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  'Entes autónomos': 6,
  'Servicios descentralizados': 6,
  'Poder Ejecutivo': 5,
  'Gobiernos departamentales y congreso de Intendentes': 4,
  'Personas públicas no estatales': 4,
  'Órganos constitucionales de control': 3,
  'Órganos especializados': 3,
  'Poder Legislativo': 3,
  'Poder Judicial': 3,
});

export type UyPublicEntityRow = {
  source_key: typeof UY_PUBLIC_ENTITIES_SOURCE_KEY;
  country_code: 'UY';
  source_year: number;
  tax_id: string | null;
  normalized_tax_id: string | null;
  legal_name: string;
  normalized_legal_name: string;
  city: string | null;
  region: string | null;
  priority_score: number;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Fila de Gobierno de una entidad, o `null` si no tiene ni web ni RUT. */
export function buildUyPublicEntityRow(params: {
  entity: UyPublicEntity;
  /** RUT del RUPE si la entidad está inscrita (lo busca el ETL); `null` si no. */
  rut: string | null;
  /** Funcionarios oficiales de la entidad (ONSC), si es un inciso medido. */
  workforce?: UyOnscHeadcount | null;
  sourceYear: number;
  importedAt: string;
}): UyPublicEntityRow | null {
  const { entity, rut } = params;
  const workforce = params.workforce && params.workforce.workers >= 1 ? params.workforce : null;
  if (entity.domain === null && rut === null) return null;
  const junta = /^Junta Departamental/i.test(entity.name);
  const base = (GROUP_PRIORITY[entity.group] ?? 2) - (junta ? 2 : 0);
  // Grano nativo: una fila por entidad (`uy-public-entity:<inciso o unidad>`), tenga o no RUT.
  const identity = buildRecordIdentityKey(UY_PUBLIC_ENTITY_IDENTITY_NAMESPACE, entity.key);
  return {
    source_key: UY_PUBLIC_ENTITIES_SOURCE_KEY,
    country_code: 'UY',
    source_year: params.sourceYear,
    tax_id: rut,
    normalized_tax_id: rut,
    legal_name: entity.name,
    normalized_legal_name: uruguayNameCore(entity.name),
    city: null,
    region: null,
    priority_score: base * 10 + (rut !== null ? 1 : 0),
    raw_data: {
      directory_kind: 'public_entity',
      macro_industry_key: UY_PUBLIC_ENTITY_MACRO,
      public_group: entity.group,
      acronyms: entity.acronyms,
      ...(entity.domain ? { website_domain: entity.domain, website_origin: 'uaip_institutional_email' } : {}),
      ...(workforce
        ? { official_workers: workforce.workers, official_workers_year: workforce.year, official_workers_source: 'onsc_vinculos' }
        : {}),
    },
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

/** Fila del CSV de la UAIP → referente (sin datos personales), o `null`. */
export function parseUyTransparencyReferent(record: Record<string, string>): UyTransparencyReferent | null {
  const get = (key: string): string => (record[key] ?? '').replace(/\s+/g, ' ').trim();
  const unitName = get('Nombre Unidad Ejecutora o dependencia u organismo');
  const incisoName = get('Nombre Inciso');
  if (unitName === '' || incisoName === '' || get('Habilitado (Si o No)').toUpperCase().startsWith('N')) return null;
  const email = get('Email').toLowerCase();
  const at = email.lastIndexOf('@');
  const domain = at > 0 ? email.slice(at + 1).replace(/[^a-z0-9.-]/g, '') : '';
  const shortName = get('Nombre Corto UE');
  return {
    inciso: get('Inciso'),
    incisoName,
    unit: get('Unidad Ejecutora'),
    unitName,
    shortName: shortName.length > 0 ? shortName : null,
    group: get('Grupos de organismos'),
    emailDomain: domain.includes('.') ? domain : null,
  };
}

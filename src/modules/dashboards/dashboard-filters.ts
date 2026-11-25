// TABLEROS-1 — Los filtros de /dashboards («Tableros»), sin React ni E/S.
//
// Todo vive en la URL (un enlace comparte la vista exacta y una vista guardada
// es sólo una URL): periodo con atajos o rango a mano, cómo se agrupa el tiempo,
// equipos, personas, fuentes, países y si las fuentes se ven una a una o juntas.
//
// Las fechas son DÍAS de Bogotá (`2026-11-25`). Bogotá no tiene horario de verano
// (UTC-5 fijo desde 1993), así que el día empieza siempre a las 05:00 UTC.

/** Lanzamiento de SellUp a los equipos internos (dueño 25-11): nada de antes se muestra. */
export const DASHBOARDS_LAUNCH_DAY = '2026-11-11';

/** Bogotá va 5 horas por detrás de UTC, todo el año. */
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;
/** Tope de valores por filtro de lista: protege la URL y las consultas `.in()`. */
const MAX_LIST_VALUES = 50;

export const PERIOD_PRESETS = [
  'since_launch',
  'this_month',
  'last_month',
  'last_7',
  'last_30',
  'last_90',
  'this_quarter',
  'custom',
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  since_launch: 'Desde el lanzamiento',
  this_month: 'Este mes',
  last_month: 'Mes pasado',
  last_7: 'Últimos 7 días',
  last_30: 'Últimos 30 días',
  last_90: 'Últimos 90 días',
  this_quarter: 'Este trimestre',
  custom: 'Rango a mano',
};

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: 'Por día',
  week: 'Por semana',
  month: 'Por mes',
};

/** `split`: cada fuente por separado. `grouped`: las fuentes elegidas como una sola. */
export type SourceView = 'split' | 'grouped';

/** Los nombres de los parámetros en la URL. `tab` es de las pestañas y se conserva. */
export const DASHBOARD_PARAM = {
  period: 'periodo',
  from: 'desde',
  to: 'hasta',
  granularity: 'agrupar',
  teams: 'equipos',
  people: 'personas',
  sources: 'fuentes',
  countries: 'paises',
  sourceView: 'fuente_vista',
} as const;

export const DASHBOARD_PARAM_NAMES: readonly string[] = Object.values(DASHBOARD_PARAM);

export interface DashboardFilters {
  period: PeriodPreset;
  /** Sólo con `custom`: el rango pedido tal cual (días de Bogotá). */
  customFrom: string | null;
  customTo: string | null;
  granularity: Granularity;
  teams: string[];
  people: string[];
  sources: string[];
  countries: string[];
  sourceView: SourceView;
}

export const DEFAULT_DASHBOARD_FILTERS: DashboardFilters = {
  period: 'since_launch',
  customFrom: null,
  customTo: null,
  granularity: 'week',
  teams: [],
  people: [],
  sources: [],
  countries: [],
  sourceView: 'split',
};

export type SearchParamsRecord = Readonly<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function parseList(raw: string, valid: RegExp, normalize: (value: string) => string = (v) => v): string[] {
  const out: string[] = [];
  for (const piece of raw.split(',')) {
    const value = normalize(piece.trim());
    if (!value || !valid.test(value) || out.includes(value)) continue;
    out.push(value);
    if (out.length >= MAX_LIST_VALUES) break;
  }
  return out;
}

export function isIsoDay(value: string | null | undefined): value is string {
  if (!value || !ISO_DAY.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** Lee los filtros de la URL. Lo que no se entiende se ignora, nunca rompe la página. */
export function parseDashboardFilters(params: SearchParamsRecord): DashboardFilters {
  const periodRaw = first(params[DASHBOARD_PARAM.period]);
  const period = (PERIOD_PRESETS as readonly string[]).includes(periodRaw)
    ? (periodRaw as PeriodPreset)
    : DEFAULT_DASHBOARD_FILTERS.period;
  const granularityRaw = first(params[DASHBOARD_PARAM.granularity]);
  const granularity = (GRANULARITIES as readonly string[]).includes(granularityRaw)
    ? (granularityRaw as Granularity)
    : DEFAULT_DASHBOARD_FILTERS.granularity;
  const from = first(params[DASHBOARD_PARAM.from]);
  const to = first(params[DASHBOARD_PARAM.to]);

  return {
    period,
    customFrom: period === 'custom' && isIsoDay(from) ? from : null,
    customTo: period === 'custom' && isIsoDay(to) ? to : null,
    granularity,
    teams: parseList(first(params[DASHBOARD_PARAM.teams]), UUID, (v) => v.toLowerCase()),
    people: parseList(first(params[DASHBOARD_PARAM.people]), UUID, (v) => v.toLowerCase()),
    sources: parseList(first(params[DASHBOARD_PARAM.sources]), SOURCE_KEY, (v) => v.toLowerCase()),
    countries: parseList(first(params[DASHBOARD_PARAM.countries]), COUNTRY_CODE, (v) => v.toUpperCase()),
    sourceView: first(params[DASHBOARD_PARAM.sourceView]) === 'agrupada' ? 'grouped' : 'split',
  };
}

/**
 * La query de la URL con estos filtros. Conserva lo que no es un filtro (la
 * pestaña) y no escribe lo que está en su valor por defecto, para que la URL
 * de la vista por defecto quede limpia.
 */
export function toDashboardQuery(current: string, filters: DashboardFilters): string {
  const params = new URLSearchParams(current);
  for (const name of DASHBOARD_PARAM_NAMES) params.delete(name);

  if (filters.period !== DEFAULT_DASHBOARD_FILTERS.period) params.set(DASHBOARD_PARAM.period, filters.period);
  if (filters.period === 'custom') {
    if (filters.customFrom) params.set(DASHBOARD_PARAM.from, filters.customFrom);
    if (filters.customTo) params.set(DASHBOARD_PARAM.to, filters.customTo);
  }
  if (filters.granularity !== DEFAULT_DASHBOARD_FILTERS.granularity) {
    params.set(DASHBOARD_PARAM.granularity, filters.granularity);
  }
  if (filters.teams.length > 0) params.set(DASHBOARD_PARAM.teams, filters.teams.join(','));
  if (filters.people.length > 0) params.set(DASHBOARD_PARAM.people, filters.people.join(','));
  if (filters.sources.length > 0) params.set(DASHBOARD_PARAM.sources, filters.sources.join(','));
  if (filters.countries.length > 0) params.set(DASHBOARD_PARAM.countries, filters.countries.join(','));
  if (filters.sourceView === 'grouped') params.set(DASHBOARD_PARAM.sourceView, 'agrupada');
  return params.toString();
}

/** ¿Hay algún filtro distinto del de por defecto? (el periodo y el agrupado no cuentan). */
export function hasNarrowingFilters(filters: DashboardFilters): boolean {
  return (
    filters.teams.length > 0 ||
    filters.people.length > 0 ||
    filters.sources.length > 0 ||
    filters.countries.length > 0
  );
}

// ── Días de Bogotá ─────────────────────────────────────────────────────────────

/** El día de Bogotá de un instante ISO (`2026-11-25T03:00:00Z` → `2026-11-24`). */
export function bogotaDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

/** El instante UTC en que empieza un día de Bogotá. */
export function bogotaDayStartIso(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + BOGOTA_OFFSET_MS).toISOString();
}

export function addDays(day: string, amount: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + amount * DAY_MS).toISOString().slice(0, 10);
}

/** Días completos entre dos días (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / DAY_MS);
}

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function shiftMonth(day: string, amount: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7)) - 1 + amount;
  const date = new Date(Date.UTC(year, month, 1));
  return date.toISOString().slice(0, 10);
}

/** El lunes de la semana del día. */
export function weekStart(day: string): string {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay(); // 0 = domingo
  const sinceMonday = (weekday + 6) % 7;
  return addDays(day, -sinceMonday);
}

export interface ResolvedRange {
  /** Primer día incluido. */
  fromDay: string;
  /** Último día incluido. */
  toDay: string;
  /** Instante inclusivo para las consultas (`>=`). */
  fromIso: string;
  /** Instante exclusivo para las consultas (`<`): el día siguiente a `toDay`. */
  toIsoExclusive: string;
  /** El periodo pedido empezaba antes del lanzamiento y se recortó. */
  clampedToLaunch: boolean;
  /** El periodo pedido es entero anterior al lanzamiento: no hay nada que leer. */
  isEmpty: boolean;
}

/**
 * Convierte el periodo pedido en un rango de días, recortado al lanzamiento
 * (11-11-2026) y a hoy. Un rango a mano incompleto o al revés se corrige.
 */
export function resolveDashboardRange(
  filters: Pick<DashboardFilters, 'period' | 'customFrom' | 'customTo'>,
  today: string,
  launchDay: string = DASHBOARDS_LAUNCH_DAY,
): ResolvedRange {
  let from: string;
  let to: string = today;
  switch (filters.period) {
    case 'this_month':
      from = monthStart(today);
      break;
    case 'last_month':
      from = shiftMonth(today, -1);
      to = addDays(monthStart(today), -1);
      break;
    case 'last_7':
      from = addDays(today, -6);
      break;
    case 'last_30':
      from = addDays(today, -29);
      break;
    case 'last_90':
      from = addDays(today, -89);
      break;
    case 'this_quarter': {
      const month = Number(today.slice(5, 7));
      const quarterFirstMonth = Math.floor((month - 1) / 3) * 3 + 1;
      from = `${today.slice(0, 4)}-${String(quarterFirstMonth).padStart(2, '0')}-01`;
      break;
    }
    case 'custom': {
      const a = filters.customFrom ?? launchDay;
      const b = filters.customTo ?? today;
      [from, to] = a <= b ? [a, b] : [b, a];
      break;
    }
    case 'since_launch':
    default:
      from = launchDay;
  }

  if (to > today) to = today;
  const clampedToLaunch = from < launchDay;
  if (clampedToLaunch) from = launchDay;
  const isEmpty = to < from;
  if (isEmpty) to = from;

  return {
    fromDay: from,
    toDay: to,
    fromIso: bogotaDayStartIso(from),
    toIsoExclusive: bogotaDayStartIso(addDays(to, 1)),
    clampedToLaunch,
    isEmpty,
  };
}

/** ¿Este instante cae dentro del rango? */
export function isWithinRange(iso: string | null | undefined, range: Pick<ResolvedRange, 'fromIso' | 'toIsoExclusive'>): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  return ms >= Date.parse(range.fromIso) && ms < Date.parse(range.toIsoExclusive);
}

// ── Cubetas de tiempo ─────────────────────────────────────────────────────────

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** La clave de la cubeta de un día: el día, el lunes de su semana o `AAAA-MM`. */
export function bucketKeyForDay(day: string, granularity: Granularity): string {
  if (granularity === 'month') return day.slice(0, 7);
  if (granularity === 'week') return weekStart(day);
  return day;
}

export function bucketKeyForIso(iso: string | null | undefined, granularity: Granularity): string | null {
  const day = bogotaDayOf(iso);
  return day ? bucketKeyForDay(day, granularity) : null;
}

/** «23 nov», «Sem 23 nov», «nov 2026». */
export function bucketLabel(key: string, granularity: Granularity): string {
  const month = MONTHS_ES[Number(key.slice(5, 7)) - 1] ?? key.slice(5, 7);
  if (granularity === 'month') return `${month} ${key.slice(0, 4)}`;
  const dayLabel = `${Number(key.slice(8, 10))} ${month}`;
  return granularity === 'week' ? `Sem ${dayLabel}` : dayLabel;
}

export interface Bucket {
  key: string;
  label: string;
}

/** Todas las cubetas del rango, en orden y sin huecos (las vacías también cuentan). */
export function listBuckets(range: Pick<ResolvedRange, 'fromDay' | 'toDay'>, granularity: Granularity): Bucket[] {
  const keys: string[] = [];
  const last = bucketKeyForDay(range.toDay, granularity);
  let cursor = bucketKeyForDay(range.fromDay, granularity);
  // Tope de seguridad: un rango de años por día no debe colgar la página.
  for (let i = 0; i < 1000; i++) {
    keys.push(cursor);
    if (cursor >= last) break;
    if (granularity === 'month') cursor = shiftMonth(`${cursor}-01`, 1).slice(0, 7);
    else cursor = addDays(cursor, granularity === 'week' ? 7 : 1);
  }
  return keys.map((key) => ({ key, label: bucketLabel(key, granularity) }));
}

/** Texto del rango para los títulos: «11 nov 2026 – 25 nov 2026 (15 días)». */
export function describeRange(range: Pick<ResolvedRange, 'fromDay' | 'toDay'>): string {
  const format = (day: string) =>
    `${Number(day.slice(8, 10))} ${MONTHS_ES[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
  const days = daysBetween(range.fromDay, range.toDay) + 1;
  return `${format(range.fromDay)} – ${format(range.toDay)} (${days} ${days === 1 ? 'día' : 'días'})`;
}

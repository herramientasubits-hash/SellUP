import { appDayKey } from '@/lib/format-date';
import { MOVEMENT_THRESHOLDS, SIGNAL_IDS } from './signals';
import { PIPELINE_STAGE_IDS } from './stages';
import type { PipelineOverviewAccount, PipelineSignalId, PipelineStageId } from './types';

/**
 * Filtros del Pipeline: PUROS. Todo se filtra en cliente sobre lo que ya trae
 * `getPipelineOverview()`; aquí viven el estado, cómo se aplica, los conteos de
 * cada opción y cómo va y vuelve de la URL. Sin red y sin reloj propio (`now`
 * entra como parámetro).
 *
 * Dentro de un grupo, varias opciones son una UNIÓN; entre grupos, una
 * INTERSECCIÓN.
 */

/** El valor de «sin país» / «sin industria» en el estado y en la URL. */
export const NONE_VALUE = '-';

/** Sobre qué fecha filtra el grupo «Fecha». */
export type PipelineDateField = 'mov' | 'entrada';

export type PipelineDatePreset = 'hoy' | '7d' | '30d' | 'mes';

export const DATE_PRESETS: readonly PipelineDatePreset[] = ['hoy', '7d', '30d', 'mes'];

/** Umbrales excluyentes de inactividad (días): los de `MOVEMENT_THRESHOLDS`, o «sin riesgo». */
export type PipelineInactivity = 7 | 14 | 21 | 'none';

export const INACTIVITY_OPTIONS: readonly PipelineInactivity[] = [
  MOVEMENT_THRESHOLDS.notice,
  MOVEMENT_THRESHOLDS.alert,
  MOVEMENT_THRESHOLDS.critical,
  'none',
];

/**
 * Los fallos de IA, por etapa/agente. Hoy solo existe el del Agente 2A; cuando
 * haya más agentes, su señal de fallo se añade aquí con su etapa.
 */
export const AI_FAILURE_SIGNALS: readonly { signal: PipelineSignalId; stageId: PipelineStageId }[] = [
  { signal: 'corrida_fallida', stageId: 'enriquecimiento' },
];

const AI_FAILURE_IDS: readonly PipelineSignalId[] = AI_FAILURE_SIGNALS.map((entry) => entry.signal);

/** Las demás señales, como casillas: ni la inactividad (tiene su grupo) ni los fallos de IA. */
export const OTHER_SIGNAL_IDS: readonly PipelineSignalId[] = SIGNAL_IDS.filter(
  (id) => id !== 'sin_movimiento' && !AI_FAILURE_IDS.includes(id),
);

export interface PipelineFilters {
  stages: PipelineStageId[];
  /** Códigos ISO de país; `NONE_VALUE` = sin país. */
  countries: string[];
  /** Industrias tal cual; `NONE_VALUE` = sin industria. */
  industries: string[];
  inactivity: PipelineInactivity | null;
  aiFailures: PipelineSignalId[];
  signals: PipelineSignalId[];
  dateField: PipelineDateField;
  /** Un periodo relativo a hoy. Excluyente con `from`/`to`. */
  datePreset: PipelineDatePreset | null;
  /** Rango libre, días `AAAA-MM-DD` en la zona de la aplicación (inclusive). */
  from: string | null;
  to: string | null;
}

export const EMPTY_PIPELINE_FILTERS: PipelineFilters = {
  stages: [],
  countries: [],
  industries: [],
  inactivity: null,
  aiFailures: [],
  signals: [],
  dateField: 'mov',
  datePreset: null,
  from: null,
  to: null,
};

export function hasDateFilter(filters: PipelineFilters): boolean {
  return filters.datePreset !== null || filters.from !== null || filters.to !== null;
}

/** Cuántos filtros hay puestos: uno por valor elegido; la fecha y la inactividad cuentan una vez. */
export function countActiveFilters(filters: PipelineFilters): number {
  return (
    filters.stages.length +
    filters.countries.length +
    filters.industries.length +
    filters.aiFailures.length +
    filters.signals.length +
    (filters.inactivity !== null ? 1 : 0) +
    (hasDateFilter(filters) ? 1 : 0)
  );
}

// ── Fechas ─────────────────────────────────────────────────────

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function shiftDayKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** El rango de días (inclusive, zona de la aplicación) de un periodo relativo a `now`. */
export function resolveDatePreset(preset: PipelineDatePreset, now: Date): { from: string; to: string } {
  const today = appDayKey(now) as string;
  switch (preset) {
    case 'hoy':
      return { from: today, to: today };
    case '7d':
      return { from: shiftDayKey(today, -6), to: today };
    case '30d':
      return { from: shiftDayKey(today, -29), to: today };
    case 'mes':
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

/** El rango efectivo del filtro de fecha; `null` en un extremo = abierto. */
export function resolveDateRange(
  filters: PipelineFilters,
  now: Date,
): { from: string | null; to: string | null } | null {
  if (filters.datePreset) return resolveDatePreset(filters.datePreset, now);
  if (filters.from === null && filters.to === null) return null;
  return { from: filters.from, to: filters.to };
}

// ── Aplicar ────────────────────────────────────────────────────

function matchesInactivity(days: number, inactivity: PipelineInactivity): boolean {
  return inactivity === 'none' ? days < MOVEMENT_THRESHOLDS.notice : days >= inactivity;
}

function hasAnySignal(account: PipelineOverviewAccount, ids: readonly PipelineSignalId[]): boolean {
  return account.signals.some((signal) => ids.includes(signal.id));
}

export function applyPipelineFilters(
  accounts: readonly PipelineOverviewAccount[],
  filters: PipelineFilters,
  now: Date,
): PipelineOverviewAccount[] {
  const range = resolveDateRange(filters, now);

  return accounts.filter((account) => {
    if (filters.stages.length > 0 && !(account.currentStageId && filters.stages.includes(account.currentStageId))) {
      return false;
    }
    if (filters.countries.length > 0 && !filters.countries.includes(account.countryCode?.toUpperCase() ?? NONE_VALUE)) {
      return false;
    }
    if (filters.industries.length > 0 && !filters.industries.includes(account.industry?.trim() || NONE_VALUE)) {
      return false;
    }
    if (filters.inactivity !== null && !matchesInactivity(account.daysSinceMovement, filters.inactivity)) return false;
    if (filters.aiFailures.length > 0 && !hasAnySignal(account, filters.aiFailures)) return false;
    if (filters.signals.length > 0 && !hasAnySignal(account, filters.signals)) return false;
    if (range) {
      const day = appDayKey(filters.dateField === 'entrada' ? account.createdAt : account.lastMovementAt);
      if (!day) return false;
      if (range.from && day < range.from) return false;
      if (range.to && day > range.to) return false;
    }
    return true;
  });
}

// ── Opciones y conteos (sobre el total, no sobre lo filtrado) ──

export interface FilterOptionCount<T extends string | number = string> {
  value: T;
  count: number;
}

export interface PipelineFilterOptions {
  stages: FilterOptionCount<PipelineStageId>[];
  /** Los países presentes, de más a menos empresas; «sin país» al final si hay nulos. */
  countries: FilterOptionCount[];
  industries: FilterOptionCount[];
  inactivity: FilterOptionCount<PipelineInactivity>[];
  aiFailures: (FilterOptionCount<PipelineSignalId> & { stageId: PipelineStageId })[];
  signals: FilterOptionCount<PipelineSignalId>[];
}

function countPresent(values: readonly string[]): FilterOptionCount[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => {
      if ((a.value === NONE_VALUE) !== (b.value === NONE_VALUE)) return a.value === NONE_VALUE ? 1 : -1;
      return b.count - a.count || a.value.localeCompare(b.value, 'es');
    });
}

export function countFilterOptions(accounts: readonly PipelineOverviewAccount[]): PipelineFilterOptions {
  const signalCount = (id: PipelineSignalId) => accounts.filter((account) => hasAnySignal(account, [id])).length;

  return {
    stages: PIPELINE_STAGE_IDS.map((value) => ({
      value,
      count: accounts.filter((account) => account.currentStageId === value).length,
    })),
    countries: countPresent(accounts.map((account) => account.countryCode?.toUpperCase() ?? NONE_VALUE)),
    industries: countPresent(accounts.map((account) => account.industry?.trim() || NONE_VALUE)),
    inactivity: INACTIVITY_OPTIONS.map((value) => ({
      value,
      count: accounts.filter((account) => matchesInactivity(account.daysSinceMovement, value)).length,
    })),
    aiFailures: AI_FAILURE_SIGNALS.map((entry) => ({
      value: entry.signal,
      stageId: entry.stageId,
      count: signalCount(entry.signal),
    })),
    signals: OTHER_SIGNAL_IDS.map((value) => ({ value, count: signalCount(value) })),
  };
}

// ── La franja de atención y los filtros son el MISMO estado ────

/** ¿Está puesto el filtro que corresponde a esta señal? */
export function isSignalFiltered(filters: PipelineFilters, signal: PipelineSignalId): boolean {
  if (signal === 'sin_movimiento') return filters.inactivity === MOVEMENT_THRESHOLDS.notice;
  if (AI_FAILURE_IDS.includes(signal)) return filters.aiFailures.includes(signal);
  return filters.signals.includes(signal);
}

function toggle<T>(list: readonly T[], value: T, order: readonly T[]): T[] {
  const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  return order.filter((item) => next.includes(item));
}

/** Pulsar un motivo de la franja de atención marca (o desmarca) su casilla en los filtros. */
export function toggleSignalFilter(filters: PipelineFilters, signal: PipelineSignalId): PipelineFilters {
  if (signal === 'sin_movimiento') {
    return {
      ...filters,
      inactivity: filters.inactivity === MOVEMENT_THRESHOLDS.notice ? null : MOVEMENT_THRESHOLDS.notice,
    };
  }
  if (AI_FAILURE_IDS.includes(signal)) {
    return { ...filters, aiFailures: toggle(filters.aiFailures, signal, AI_FAILURE_IDS) };
  }
  return { ...filters, signals: toggle(filters.signals, signal, OTHER_SIGNAL_IDS) };
}

// ── URL ────────────────────────────────────────────────────────

/** Las claves de la URL que son de los filtros (no `view` ni `account`). */
export const PIPELINE_FILTER_PARAMS = [
  'etapa',
  'pais',
  'industria',
  'inactividad',
  'fallo',
  'senal',
  'fecha',
  'periodo',
  'desde',
  'hasta',
] as const;

/** Las industrias pueden llevar comas o barras: se separan con `~`. */
const INDUSTRY_SEPARATOR = '~';

type ParamSource = Record<string, string | string[] | undefined> | URLSearchParams;

function readParam(source: ParamSource, key: string): string | null {
  const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function splitList(value: string | null, separator = ','): string[] {
  if (!value) return [];
  return [...new Set(value.split(separator).map((item) => item.trim()).filter(Boolean))];
}

/** Lee los filtros de la URL sin confiar en su forma: lo desconocido se descarta. */
export function parsePipelineFilters(source: ParamSource): PipelineFilters {
  const inactivityRaw = readParam(source, 'inactividad');
  const inactivity: PipelineInactivity | null =
    inactivityRaw === 'no'
      ? 'none'
      : (INACTIVITY_OPTIONS.find((option) => String(option) === inactivityRaw) as PipelineInactivity | undefined) ?? null;
  const preset = readParam(source, 'periodo');
  const datePreset = DATE_PRESETS.find((option) => option === preset) ?? null;
  const dayKey = (key: string) => {
    const value = readParam(source, key);
    return value && DAY_KEY.test(value) ? value : null;
  };
  const from = datePreset ? null : dayKey('desde');
  const to = datePreset ? null : dayKey('hasta');
  const signalIds = splitList(readParam(source, 'senal'));

  return {
    stages: PIPELINE_STAGE_IDS.filter((id) => splitList(readParam(source, 'etapa')).includes(id)),
    countries: splitList(readParam(source, 'pais')).map((code) => (code === NONE_VALUE ? code : code.toUpperCase())),
    industries: splitList(readParam(source, 'industria'), INDUSTRY_SEPARATOR),
    inactivity,
    aiFailures: readParam(source, 'fallo') === '1' ? [...AI_FAILURE_IDS] : [],
    signals: OTHER_SIGNAL_IDS.filter((id) => signalIds.includes(id)),
    dateField: readParam(source, 'fecha') === 'entrada' ? 'entrada' : 'mov',
    datePreset,
    from,
    to,
  };
}

/** Los filtros como parámetros compactos de URL; lo que es por defecto no ensucia la URL. */
export function serializePipelineFilters(filters: PipelineFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.stages.length > 0) params.etapa = filters.stages.join(',');
  if (filters.countries.length > 0) params.pais = filters.countries.join(',');
  if (filters.industries.length > 0) params.industria = filters.industries.join(INDUSTRY_SEPARATOR);
  if (filters.inactivity !== null) params.inactividad = filters.inactivity === 'none' ? 'no' : String(filters.inactivity);
  if (filters.aiFailures.length > 0) params.fallo = '1';
  if (filters.signals.length > 0) params.senal = filters.signals.join(',');
  if (hasDateFilter(filters)) {
    if (filters.dateField === 'entrada') params.fecha = 'entrada';
    if (filters.datePreset) params.periodo = filters.datePreset;
    else {
      if (filters.from) params.desde = filters.from;
      if (filters.to) params.hasta = filters.to;
    }
  }
  return params;
}

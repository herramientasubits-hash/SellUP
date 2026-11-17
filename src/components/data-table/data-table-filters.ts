/**
 * Los filtros de columna de `DataTable`, en puro (sin React): qué guarda cada
 * embudo y cómo decide si una fila pasa.
 *
 * Dueño 17-11: «filtro en todas las columnas de las 7 vistas de Empresas y
 * Contactos». Cada columna se filtra según lo que guarda:
 *
 * - Valores conocidos (país, estado, fuente…) → casillas, con «(Vacío)» para
 *   las filas sin dato.
 * - Tramos («0 · 1–2 · 3–5 · 6+») y «tiene / no tiene» → casillas sobre una
 *   clave calculada (`meta.filterKey`).
 * - Texto libre (nombre, cargo, dominio) → «contiene» y «con dato / sin dato».
 * - Fechas → rango, atajos («últimos 30 días», «hace más de 90 días»…) y
 *   «sin fecha».
 *
 * El valor del filtro dice qué tipo es (lista, `{contains}`, `{from,to}`), así
 * que un solo `filterFn` por defecto sirve para todas las columnas.
 */

import { appDayKey } from '@/lib/format-date';
import type { DataTableColumnFilterOption } from './data-table-column-meta';

// ── Valores vacíos ─────────────────────────────────────────────

/** La opción «(Vacío)» del embudo: las filas sin dato en esa columna. */
export const EMPTY_FILTER_VALUE = '__empty__';
export const EMPTY_FILTER_LABEL = '(Vacío)';

export function isEmptyCellValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// ── Casillas (valores, tramos, tiene / no tiene) ───────────────

/** La clave de opción de una celda: la de `filterKey`, el texto del valor o «(Vacío)». */
export function optionKeysOf(value: unknown, filterKey?: (value: unknown) => string): string[] {
  if (filterKey) return [filterKey(value)];
  if (Array.isArray(value)) {
    return value.length === 0 ? [EMPTY_FILTER_VALUE] : value.map((item) => String(item));
  }
  return isEmptyCellValue(value) ? [EMPTY_FILTER_VALUE] : [String(value)];
}

export function matchesOptionFilter(
  value: unknown,
  selected: readonly string[],
  filterKey?: (value: unknown) => string,
): boolean {
  if (selected.length === 0) return true;
  return optionKeysOf(value, filterKey).some((key) => selected.includes(key));
}

/** Un tramo de un número: `{ key: '3-5', label: '3 a 5', min: 3, max: 5 }`. */
export interface CountBucket {
  key: string;
  label: string;
  min: number;
  /** Sin tope: «6 o más». */
  max?: number;
}

/**
 * Tramos a partir de sus cortes: `[0, 1, 3, 6]` → 0 · 1–2 · 3–5 · 6+.
 * El primer corte suele ser 0 («Ninguno»).
 */
export function countBuckets(edges: readonly number[], zeroLabel = 'Ninguno'): CountBucket[] {
  return edges.map((min, index) => {
    const next = edges[index + 1];
    const max = next === undefined ? undefined : next - 1;
    const label =
      max === undefined
        ? `${min} o más`
        : min === max
          ? min === 0
            ? zeroLabel
            : String(min)
          : `${min} a ${max}`;
    return { key: max === undefined ? `${min}+` : min === max ? String(min) : `${min}-${max}`, label, min, max };
  });
}

/** La clave del tramo de un número (sin número, el primer tramo si arranca en 0). */
export function countBucketKey(buckets: readonly CountBucket[], value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const hit = buckets.find((bucket) => safe >= bucket.min && (bucket.max === undefined || safe <= bucket.max));
  return hit?.key ?? buckets[0]?.key ?? EMPTY_FILTER_VALUE;
}

/** Lo que una columna de tramos pone en su `meta`. */
export function countBucketFilter(
  edges: readonly number[],
  zeroLabel?: string,
): { filterOptions: DataTableColumnFilterOption[]; filterKey: (value: unknown) => string } {
  const buckets = countBuckets(edges, zeroLabel);
  return {
    filterOptions: buckets.map((bucket) => ({ value: bucket.key, label: bucket.label })),
    filterKey: (value) => countBucketKey(buckets, value),
  };
}

export const PRESENCE_YES = 'yes';
export const PRESENCE_NO = 'no';

/** Lo que una columna «tiene / no tiene» pone en su `meta`. */
export function presenceFilter(
  yesLabel: string,
  noLabel: string,
): { filterOptions: DataTableColumnFilterOption[]; filterKey: (value: unknown) => string } {
  return {
    filterOptions: [
      { value: PRESENCE_YES, label: yesLabel },
      { value: PRESENCE_NO, label: noLabel },
    ],
    filterKey: (value) => (isEmptyCellValue(value) || value === 0 || value === false ? PRESENCE_NO : PRESENCE_YES),
  };
}

// ── Texto libre ────────────────────────────────────────────────

export interface TextFilterValue {
  /** Lo que tiene que contener (sin distinguir mayúsculas ni tildes). */
  contains?: string;
  /** `filled`: con dato · `empty`: sin dato. */
  presence?: 'filled' | 'empty';
}

export function isTextFilterValue(value: unknown): value is TextFilterValue {
  return !!value && typeof value === 'object' && !Array.isArray(value) && ('contains' in value || 'presence' in value);
}

/** El filtro normalizado: `undefined` si no filtra nada. */
export function normalizeTextFilter(value: TextFilterValue): TextFilterValue | undefined {
  const contains = value.contains?.trim() ? value.contains : undefined;
  const presence = value.presence;
  if (!contains && !presence) return undefined;
  return { ...(contains ? { contains } : {}), ...(presence ? { presence } : {}) };
}

/** Minúsculas y sin tildes: «Gestión» encuentra «gestion». */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

export function matchesTextFilter(value: unknown, filter: TextFilterValue): boolean {
  const empty = isEmptyCellValue(value);
  if (filter.presence === 'empty' && !empty) return false;
  if (filter.presence === 'filled' && empty) return false;
  const needle = filter.contains ? foldText(filter.contains) : '';
  if (!needle) return true;
  if (empty) return false;
  const haystack = Array.isArray(value) ? value.map(String).join(' ') : String(value);
  return foldText(haystack).includes(needle);
}

export function describeTextFilter(filter: TextFilterValue): string {
  const parts: string[] = [];
  if (filter.contains?.trim()) parts.push(`contiene «${filter.contains.trim()}»`);
  if (filter.presence === 'filled') parts.push('con dato');
  if (filter.presence === 'empty') parts.push('sin dato');
  return parts.join(' · ');
}

// ── Fechas ─────────────────────────────────────────────────────

export interface DateFilterValue {
  /** Día inicial `AAAA-MM-DD` (incluido), en la zona de la aplicación. */
  from?: string;
  /** Día final `AAAA-MM-DD` (incluido). */
  to?: string;
  /** Sólo las filas sin fecha. */
  empty?: boolean;
  /** El atajo elegido, para nombrar el chip («Últimos 30 días»). */
  preset?: string;
}

export function isDateFilterValue(value: unknown): value is DateFilterValue {
  return !!value && typeof value === 'object' && !Array.isArray(value) && ('from' in value || 'to' in value || 'empty' in value);
}

export function normalizeDateFilter(value: DateFilterValue): DateFilterValue | undefined {
  if (value.empty) return { empty: true, ...(value.preset ? { preset: value.preset } : {}) };
  if (!value.from && !value.to) return undefined;
  return {
    ...(value.from ? { from: value.from } : {}),
    ...(value.to ? { to: value.to } : {}),
    ...(value.preset ? { preset: value.preset } : {}),
  };
}

/** El día (`AAAA-MM-DD`, zona de la aplicación) de una celda de fecha: ISO, milisegundos o Date. */
export function dateCellDay(value: unknown): string | null {
  if (isEmptyCellValue(value)) return null;
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) return appDayKey(value);
  return null;
}

export function matchesDateFilter(value: unknown, filter: DateFilterValue): boolean {
  const day = dateCellDay(value);
  if (filter.empty) return day === null;
  if (!filter.from && !filter.to) return true;
  if (day === null) return false;
  if (filter.from && day < filter.from) return false;
  if (filter.to && day > filter.to) return false;
  return true;
}

function shiftDay(day: string, deltaDays: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

export interface DatePreset {
  id: string;
  label: string;
  range: (today: string) => DateFilterValue;
}

/** Atajos para fechas que ya pasaron (creación, última actividad). */
export const PAST_DATE_PRESETS: readonly DatePreset[] = [
  { id: 'last-7', label: 'Últimos 7 días', range: (today) => ({ from: shiftDay(today, -6), to: today }) },
  { id: 'last-30', label: 'Últimos 30 días', range: (today) => ({ from: shiftDay(today, -29), to: today }) },
  { id: 'older-30', label: 'Hace más de 30 días', range: (today) => ({ to: shiftDay(today, -31) }) },
  { id: 'older-90', label: 'Hace más de 90 días', range: (today) => ({ to: shiftDay(today, -91) }) },
];

/** Atajos para fechas por venir (próxima actividad agendada). */
export const FUTURE_DATE_PRESETS: readonly DatePreset[] = [
  { id: 'next-7', label: 'Próximos 7 días', range: (today) => ({ from: today, to: shiftDay(today, 6) }) },
  { id: 'next-30', label: 'Próximos 30 días', range: (today) => ({ from: today, to: shiftDay(today, 29) }) },
  { id: 'overdue', label: 'Ya vencida', range: (today) => ({ to: shiftDay(today, -1) }) },
];

export function datePresetsFor(kind: 'past' | 'future' | undefined): readonly DatePreset[] {
  return kind === 'future' ? FUTURE_DATE_PRESETS : PAST_DATE_PRESETS;
}

export function describeDateFilter(filter: DateFilterValue): string {
  if (filter.empty) return 'sin fecha';
  const preset = filter.preset
    ? [...PAST_DATE_PRESETS, ...FUTURE_DATE_PRESETS].find((option) => option.id === filter.preset)
    : undefined;
  if (preset) return preset.label.toLowerCase();
  if (filter.from && filter.to) return `${filter.from} a ${filter.to}`;
  if (filter.from) return `desde ${filter.from}`;
  if (filter.to) return `hasta ${filter.to}`;
  return '';
}

// ── El filtro por defecto ──────────────────────────────────────

/**
 * ¿La celda pasa el filtro? El tipo lo dice el valor del filtro: lista →
 * casillas; `{contains, presence}` → texto; `{from, to, empty}` → fecha.
 */
export function matchesColumnFilter(
  value: unknown,
  filterValue: unknown,
  filterKey?: (value: unknown) => string,
): boolean {
  if (filterValue === undefined || filterValue === null) return true;
  if (Array.isArray(filterValue)) return matchesOptionFilter(value, filterValue.map(String), filterKey);
  if (isTextFilterValue(filterValue)) return matchesTextFilter(value, filterValue);
  if (isDateFilterValue(filterValue)) return matchesDateFilter(value, filterValue);
  return true;
}

// ── Orden por fecha ────────────────────────────────────────────

/** Milisegundos de una celda de fecha (ISO, número o Date); sin fecha, `null`. */
export function dateCellTime(value: unknown): number | null {
  if (isEmptyCellValue(value)) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const at = Date.parse(value);
    return Number.isFinite(at) ? at : null;
  }
  return null;
}

/**
 * Compara dos celdas de fecha por su instante (no por el texto: Supabase y
 * HubSpot escriben la zona distinto). Las vacías van al final.
 */
export function compareDateCells(a: unknown, b: unknown): number {
  const left = dateCellTime(a);
  const right = dateCellTime(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

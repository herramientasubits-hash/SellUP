// «Mapa de uso» de Uso de IA: cuánto se usa SellUp y sus agentes por rol, grupo,
// país, persona o líder, en una matriz métrica × grupo (el mapa de calor) más el
// «cuándo se usa» (día × hora) y la evolución diaria por agente. Puro: sin base de
// datos, para probarlo. Las mismas reglas de atribución que «Por rol y grupo»:
//   - consultas: rol y grupo del MOMENTO de la consulta, si no, los de hoy;
//   - empresas: de quien creó la búsqueda (lote), con su rol y grupo de hoy;
//   - país: el de la consulta o el de la búsqueda.

import { resolveUsageCredits } from '@/modules/usage-tracking/credits-display';
import { APP_TIME_ZONE } from '@/lib/format-date';
import type { DimensionedLogRow } from './usage-dimension-scope';
import { NO_GROUP_KEY, NO_ROLE_KEY } from './usage-breakdowns';

export const USAGE_MAP_DIMENSIONS = ['rol', 'grupo', 'pais', 'persona', 'lider'] as const;
export type UsageMapDimension = (typeof USAGE_MAP_DIMENSIONS)[number];

export const NO_COUNTRY_KEY = 'sin_pais';
export const NO_PERSON_KEY = 'sin_persona';
export const NO_LEADER_KEY = 'sin_lider';

/** Agentes con fila propia, en este orden. Lo que no es de ninguno va a «Otros». */
export const USAGE_MAP_AGENTS = ['agent1', 'agent2a', 'agent3'] as const;
export const OTHER_AGENT_KEY = 'otro';

export type UsageMapSection = 'uso' | 'agentes' | 'resultados' | 'costo';
export type UsageMapFormat = 'count' | 'percent' | 'usd';
/** Hacia dónde es «mejor»: más uso es mejor; menos costo por aprobada es mejor; el gasto es neutro. */
export type UsageMapDirection = 'higher' | 'lower' | 'neutral';

export interface UsageMapMetric {
  key: string;
  section: UsageMapSection;
  label: string;
  hint: string;
  format: UsageMapFormat;
  direction: UsageMapDirection;
  /** Sólo para quien ve dinero (líderes y administración). */
  money?: boolean;
}

export const USAGE_MAP_SECTIONS: ReadonlyArray<{ key: UsageMapSection; label: string; money?: boolean }> = [
  { key: 'uso', label: 'Uso de la plataforma' },
  { key: 'agentes', label: 'Uso de los agentes' },
  { key: 'resultados', label: 'Resultados' },
  { key: 'costo', label: 'Costo', money: true },
];

export interface UsageMapPerson {
  id: string;
  roleKey: string | null;
  groupId: string | null;
  managerId: string | null;
}

export interface UsageMapBatch {
  id: string;
  created_by: string | null;
  country_code: string | null;
}

export interface UsageMapOutcome {
  batchId: string;
  countryCode: string | null;
  approved: boolean;
}

export interface UsageMapInput {
  logs: readonly DimensionedLogRow[];
  /** Una por empresa que llegó a revisión (aprobada o no). */
  outcomes: readonly UsageMapOutcome[];
  /** Las búsquedas (lotes) con actividad en el ámbito. */
  searches: readonly UsageMapBatch[];
  batchesById: ReadonlyMap<string, UsageMapBatch>;
  people: readonly UsageMapPerson[];
  moneyVisible: boolean;
}

export interface UsageMapCell {
  /** `null` = no aplica (p. ej. tasa sin empresas para revisar). */
  value: number | null;
}

export interface UsageMapRow {
  metric: UsageMapMetric;
  cells: UsageMapCell[];
  total: number | null;
}

export interface UsageMapMatrix {
  /** Claves crudas de grupo; las etiquetas las pone la pantalla. */
  columns: string[];
  rows: UsageMapRow[];
}

export interface UsageMapData {
  matrices: Record<UsageMapDimension, UsageMapMatrix>;
  /** [día 0=lunes..6][hora 0..23] → consultas, en la hora de Colombia. */
  weekHours: number[][];
  /** Consultas por día y agente, para la evolución. */
  daily: Array<{ day: string; byAgent: Record<string, number> }>;
  agentsInUse: string[];
}

// ─── Métricas ────────────────────────────────────────────────────────────────

const AGENT_METRIC_LABELS: Record<string, string> = {
  agent1: 'Agente 1 · Empresas',
  agent2a: 'Agente 2 · Contactos',
  agent3: 'Rumbo · Primer contacto',
  [OTHER_AGENT_KEY]: 'Otros usos',
};

export function usageMapMetrics(agents: readonly string[], moneyVisible: boolean): UsageMapMetric[] {
  const metrics: UsageMapMetric[] = [
    { key: 'personas', section: 'uso', label: 'Personas activas', hint: 'Personas que hicieron al menos una consulta o una búsqueda.', format: 'count', direction: 'higher' },
    { key: 'busquedas', section: 'uso', label: 'Búsquedas de empresas', hint: 'Búsquedas (lotes) con actividad en el periodo.', format: 'count', direction: 'higher' },
    { key: 'consultas', section: 'uso', label: 'Consultas a IA y proveedores', hint: 'Cada llamada a un modelo de IA o a un proveedor de datos.', format: 'count', direction: 'higher' },
    { key: 'creditos', section: 'uso', label: 'Créditos usados', hint: 'Créditos de proveedores (Apollo, Lusha…) consumidos.', format: 'count', direction: 'neutral' },
    ...agents.map<UsageMapMetric>((agent) => ({
      key: `agente:${agent}`,
      section: 'agentes',
      label: AGENT_METRIC_LABELS[agent] ?? agent,
      hint: 'Consultas que hizo este agente.',
      format: 'count',
      direction: 'higher',
    })),
    { key: 'revision', section: 'resultados', label: 'Empresas para revisar', hint: 'Empresas que llegaron a «Por revisar».', format: 'count', direction: 'higher' },
    { key: 'aprobadas', section: 'resultados', label: 'Empresas aprobadas', hint: 'Empresas que alguien aprobó.', format: 'count', direction: 'higher' },
    { key: 'tasa', section: 'resultados', label: 'Tasa de aprobación', hint: 'Aprobadas sobre las que llegaron a revisión.', format: 'percent', direction: 'higher' },
  ];
  if (moneyVisible) {
    metrics.push(
      { key: 'costo', section: 'costo', label: 'Costo estimado', hint: 'Costo en dólares de las consultas con costo conocido.', format: 'usd', direction: 'neutral', money: true },
      { key: 'costo_aprobada', section: 'costo', label: 'Costo por aprobada', hint: 'Costo dividido entre las empresas aprobadas. Menos es mejor.', format: 'usd', direction: 'lower', money: true },
    );
  }
  return metrics;
}

// ─── Atribución ──────────────────────────────────────────────────────────────

interface Acc {
  people: Set<string>;
  searches: Set<string>;
  calls: number;
  credits: number;
  byAgent: Map<string, number>;
  review: number;
  approved: number;
  cost: number;
}

function newAcc(): Acc {
  return { people: new Set(), searches: new Set(), calls: 0, credits: 0, byAgent: new Map(), review: 0, approved: 0, cost: 0 };
}

function costOf(value: number | string | null): number {
  if (value === null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function agentOf(log: DimensionedLogRow): string {
  const key = log.agent_key ?? null;
  return key && (USAGE_MAP_AGENTS as readonly string[]).includes(key) ? key : OTHER_AGENT_KEY;
}

function normCountry(code: string | null | undefined): string {
  const c = (code ?? '').trim().toUpperCase();
  return c || NO_COUNTRY_KEY;
}

interface Who {
  personId: string | null;
  roleKey?: string | null;
  groupId?: string | null;
  country: string | null;
}

function keysFor(who: Who, personById: ReadonlyMap<string, UsageMapPerson>): Record<UsageMapDimension, string> {
  const person = who.personId ? personById.get(who.personId) : undefined;
  return {
    rol: who.roleKey ?? person?.roleKey ?? NO_ROLE_KEY,
    grupo: who.groupId ?? person?.groupId ?? NO_GROUP_KEY,
    pais: normCountry(who.country),
    persona: who.personId ?? NO_PERSON_KEY,
    lider: person?.managerId ?? NO_LEADER_KEY,
  };
}

function valueOf(metric: UsageMapMetric, acc: Acc): number | null {
  switch (metric.key) {
    case 'personas': return acc.people.size;
    case 'busquedas': return acc.searches.size;
    case 'consultas': return acc.calls;
    case 'creditos': return acc.credits;
    case 'revision': return acc.review;
    case 'aprobadas': return acc.approved;
    case 'tasa': return acc.review > 0 ? acc.approved / acc.review : null;
    case 'costo': return acc.cost;
    case 'costo_aprobada': return acc.approved > 0 ? acc.cost / acc.approved : null;
    default:
      if (metric.key.startsWith('agente:')) return acc.byAgent.get(metric.key.slice('agente:'.length)) ?? 0;
      return null;
  }
}

// ─── Cuándo se usa ───────────────────────────────────────────────────────────

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const ZONED_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  weekday: 'short',
  hour: '2-digit',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Día de la semana (0 = lunes), hora y día `AAAA-MM-DD` en la hora de Colombia. */
export function zonedSlot(iso: string): { weekday: number; hour: number; day: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(ZONED_PARTS.formatToParts(date).map((p) => [p.type, p.value]));
  const weekday = WEEKDAY_INDEX[parts.weekday as string];
  const hour = Number(parts.hour);
  if (weekday === undefined || !Number.isFinite(hour)) return null;
  return { weekday, hour, day: `${parts.year}-${parts.month}-${parts.day}` };
}

// ─── Armado ──────────────────────────────────────────────────────────────────

export function buildUsageMap(input: UsageMapInput): UsageMapData {
  const personById = new Map(input.people.map((p) => [p.id, p]));
  const accs = Object.fromEntries(USAGE_MAP_DIMENSIONS.map((d) => [d, new Map<string, Acc>()])) as Record<
    UsageMapDimension,
    Map<string, Acc>
  >;
  const total = newAcc();
  const agentsSeen = new Set<string>();
  const weekHours = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const daily = new Map<string, Record<string, number>>();

  const touch = (keys: Record<UsageMapDimension, string>, apply: (acc: Acc) => void) => {
    for (const dim of USAGE_MAP_DIMENSIONS) {
      const map = accs[dim];
      const acc = map.get(keys[dim]) ?? newAcc();
      map.set(keys[dim], acc);
      apply(acc);
    }
    apply(total);
  };

  for (const log of input.logs) {
    const batch = log.batch_id ? input.batchesById.get(log.batch_id) : undefined;
    const keys = keysFor(
      {
        personId: log.triggered_by,
        roleKey: log.triggered_by_role_key,
        groupId: log.triggered_by_group_id,
        country: log.country_code ?? batch?.country_code ?? null,
      },
      personById,
    );
    const agent = agentOf(log);
    agentsSeen.add(agent);
    const credits = resolveUsageCredits(log.credits_used);
    touch(keys, (acc) => {
      if (log.triggered_by) acc.people.add(log.triggered_by);
      acc.calls++;
      if (credits.state === 'known') acc.credits += credits.credits;
      acc.byAgent.set(agent, (acc.byAgent.get(agent) ?? 0) + 1);
      acc.cost += costOf(log.estimated_cost_usd);
    });
    const slot = zonedSlot(log.created_at);
    if (slot) {
      weekHours[slot.weekday][slot.hour]++;
      const day = daily.get(slot.day) ?? {};
      day[agent] = (day[agent] ?? 0) + 1;
      daily.set(slot.day, day);
    }
  }

  for (const search of input.searches) {
    const keys = keysFor({ personId: search.created_by, country: search.country_code }, personById);
    touch(keys, (acc) => {
      if (search.created_by) acc.people.add(search.created_by);
      acc.searches.add(search.id);
    });
  }

  for (const outcome of input.outcomes) {
    const batch = input.batchesById.get(outcome.batchId);
    const keys = keysFor(
      { personId: batch?.created_by ?? null, country: outcome.countryCode ?? batch?.country_code ?? null },
      personById,
    );
    touch(keys, (acc) => {
      acc.review++;
      if (outcome.approved) acc.approved++;
    });
  }

  const agentsInUse = [...USAGE_MAP_AGENTS, OTHER_AGENT_KEY].filter((a) => agentsSeen.has(a));
  const metrics = usageMapMetrics(agentsInUse, input.moneyVisible);
  const matrices = Object.fromEntries(
    USAGE_MAP_DIMENSIONS.map((dim) => {
      const map = accs[dim];
      // Las columnas, de más a menos uso: lo que más pesa queda a la izquierda.
      const columns = [...map.keys()].sort(
        (a, b) => map.get(b)!.calls - map.get(a)!.calls || map.get(b)!.searches.size - map.get(a)!.searches.size,
      );
      const rows = metrics.map<UsageMapRow>((metric) => ({
        metric,
        cells: columns.map((col) => ({ value: valueOf(metric, map.get(col)!) })),
        total: valueOf(metric, total),
      }));
      return [dim, { columns, rows }];
    }),
  ) as Record<UsageMapDimension, UsageMapMatrix>;

  return {
    matrices,
    weekHours,
    daily: [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, byAgent]) => ({ day, byAgent })),
    agentsInUse,
  };
}

// ─── Escala de color ─────────────────────────────────────────────────────────

/** Los tonos del mapa (como el de Clima de UBITS): de muy bajo a muy alto. */
export type UsageMapTone = 'very-low' | 'low' | 'mid' | 'high' | 'very-high' | 'brand-1' | 'brand-2' | 'brand-3' | 'brand-4' | 'none';

export const USAGE_MAP_BANDS: ReadonlyArray<{ tone: UsageMapTone; label: string; range: string; min: number }> = [
  { tone: 'very-high', label: 'Muy alto', range: '80 % o más del mayor', min: 0.8 },
  { tone: 'high', label: 'Alto', range: '60 a 79 %', min: 0.6 },
  { tone: 'mid', label: 'Medio', range: '40 a 59 %', min: 0.4 },
  { tone: 'low', label: 'Bajo', range: '20 a 39 %', min: 0.2 },
  { tone: 'very-low', label: 'Muy bajo', range: 'Menos del 20 %', min: 0 },
];

/**
 * Tono de una celda comparada con su fila: cada métrica tiene su escala, así que
 * se compara con el grupo que más tiene (o, si menos es mejor, con el que menos).
 * Las métricas neutras (gasto) van en la intensidad de la marca, sin semáforo.
 */
export function usageMapTone(value: number | null, rowValues: readonly (number | null)[], direction: UsageMapDirection): UsageMapTone {
  if (value === null) return 'none';
  const known = rowValues.filter((v): v is number => v !== null);
  if (known.length === 0) return 'none';
  const max = Math.max(...known);
  if (direction === 'neutral') {
    if (max <= 0 || value <= 0) return 'none';
    const r = value / max;
    return r >= 0.75 ? 'brand-4' : r >= 0.5 ? 'brand-3' : r >= 0.25 ? 'brand-2' : 'brand-1';
  }
  let ratio: number;
  if (direction === 'lower') {
    const positives = known.filter((v) => v > 0);
    const min = positives.length ? Math.min(...positives) : 0;
    ratio = value <= 0 ? 1 : min / value;
  } else {
    ratio = max > 0 ? value / max : 0;
  }
  return (USAGE_MAP_BANDS.find((b) => ratio >= b.min) ?? USAGE_MAP_BANDS[USAGE_MAP_BANDS.length - 1]).tone;
}

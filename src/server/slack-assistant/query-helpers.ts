// ============================================================
// Asistente de Slack — reglas puras de las consultas (sin Supabase).
// Alcance, fechas en hora de Bogotá, filtros de texto y país, y la regla de
// «responsable» de cada cosa, iguales a las de la plataforma.
// ============================================================

import type { CommercialScope } from '@/modules/access/commercial-scope-logic';
import type { CreatedPeriod, ProspectState, UsagePeriod } from './tool-types';

/** Bogotá (UTC-5, sin horario de verano): «hoy» y «este mes» del equipo. */
const TEAM_UTC_OFFSET_HOURS = -5;

/** `null` = sin filtro (admin). Si no, las personas visibles. */
export function scopeOwnerIds(scope: Pick<CommercialScope, 'canViewAll' | 'allowedUserIds'>): string[] | null {
  return scope.canViewAll ? null : [...scope.allowedUserIds];
}

/**
 * Empresas (y sus contactos): una persona ve una empresa si alguien de su
 * alcance es su responsable O la creó — la misma regla que Empresas y
 * Contactos en la plataforma (`ACCOUNT_OWNER_COLUMNS`).
 */
export function accountScopeClause(users: readonly string[]): string {
  const list = users.join(',');
  return `owner_id.in.(${list}),created_by.in.(${list})`;
}

/** Búsquedas: las que alguien del alcance es dueño o creó. */
export function batchScopeClause(users: readonly string[]): string {
  return accountScopeClause(users);
}

/** Inicio del periodo en hora de Bogotá, como instante ISO. */
export function usagePeriodStart(period: UsagePeriod, now: Date): string {
  const offsetMs = TEAM_UTC_OFFSET_HOURS * 3_600_000;
  const local = new Date(now.getTime() + offsetMs);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const startLocal =
    period === 'mes' ? Date.UTC(y, m, 1) : period === 'semana' ? Date.UTC(y, m, d - 6) : Date.UTC(y, m, d);
  return new Date(startLocal - offsetMs).toISOString();
}

/** `null` = sin límite de fecha. */
export function createdSince(period: CreatedPeriod | undefined, now: Date): string | null {
  return !period || period === 'todo' ? null : usagePeriodStart(period, now);
}

/** Escapa los comodines de `ilike` en lo que escribió la persona. */
export function ilikePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()]/g, ' ').trim()}%`;
}

/** País: 2 letras = código ISO exacto; si no, por nombre. */
export function countryFilter(
  pais: string | undefined,
): { column: 'country_code'; value: string } | { column: 'country'; value: string } | null {
  const value = pais?.trim();
  if (!value) return null;
  return value.length === 2 ? { column: 'country_code', value: value.toUpperCase() } : { column: 'country', value: ilikePattern(value) };
}

/** Junta dos cláusulas `or` de PostgREST en una sola: (a) Y (b). */
export function combineOr(a: string | null, b: string | null): string | null {
  if (a && b) return `and(or(${a}),or(${b}))`;
  return a || b || null;
}

/** Estados de candidata de cada vista (los de «Por revisar» son los de la pantalla). */
export const PROSPECT_STATE_STATUSES: Readonly<Record<ProspectState, readonly string[] | null>> = {
  por_revisar: ['needs_review', 'generated', 'normalized'],
  descartados: ['discarded'],
  aprobados: ['approved', 'converted_to_account'],
  duplicados: ['duplicate'],
  todos: null,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cómo buscar una empresa a partir de lo que escribió la persona. */
export function accountLookup(query: string): { kind: 'id'; value: string } | { kind: 'text'; clause: string } {
  const value = query.trim();
  if (UUID_PATTERN.test(value)) return { kind: 'id', value: value.toLowerCase() };
  const p = ilikePattern(value);
  const clauses = [`name.ilike.${p}`, `legal_name.ilike.${p}`, `domain.ilike.${p}`, `tax_identifier.ilike.${p}`];
  // Un número puede ser el ID de HubSpot.
  if (/^\d{4,}$/.test(value)) clauses.push(`hubspot_company_id.eq.${value}`);
  return { kind: 'text', clause: clauses.join(',') };
}

export function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clip(text: string | null | undefined, max: number): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Minúsculas y sin tildes, para comparar nombres como los escribe la gente. */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PersonRow {
  id: string;
  full_name: string | null;
  email: string | null;
}

/**
 * Personas que coinciden con lo que escribió alguien: «elkin garcia» encuentra a
 * «Elkin Alexis García Salazar» (cada palabra debe empezar alguna palabra del
 * nombre o del correo, sin importar tildes ni mayúsculas). Si el nombre completo
 * o el correo coinciden exactos, gana esa persona.
 */
export function matchPeople<T extends PersonRow>(rows: readonly T[], query: string): T[] {
  const wanted = normalizeText(query);
  if (!wanted) return [];
  const exact = rows.filter((r) => normalizeText(r.full_name) === wanted || normalizeText(r.email) === wanted);
  if (exact.length > 0) return exact;
  const tokens = wanted.split(/[\s@._-]+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return rows.filter((r) => {
    const words = `${normalizeText(r.full_name)} ${normalizeText(r.email)}`.split(/[\s@._-]+/).filter(Boolean);
    return tokens.every((t) => words.some((w) => w.startsWith(t)));
  });
}

/** La persona y toda su gente a cargo en cascada (por `manager_id`). */
export function cascadeIds(rootId: string, rows: ReadonlyArray<{ id: string; manager_id: string | null }>): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (r.manager_id) childrenOf.set(r.manager_id, [...(childrenOf.get(r.manager_id) ?? []), r.id]);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

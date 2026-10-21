/**
 * Agente 3 · el registro de corridas en el servidor (puro, sin red ni base).
 *
 * Cada «Preparar el primer contacto» queda en `agent_runs` (agent_key `agent3`) con el
 * MISMO id que el navegador: así se ve desde otro equipo o tras cerrar la pestaña, el
 * Centro de procesos sabe cómo terminó aunque se haya perdido la respuesta, y lo que
 * Vercel cortó a los 300 s se cierra solo (antes quedaba «en curso» para siempre).
 */

import type { FirstContactRunStatus } from './first-contact-runs-store';

/** `agent_runs.agent_key` del Agente 3 (Uso de IA lo muestra como «agent3»). */
export const FIRST_CONTACT_RUN_AGENT_KEY = 'agent3';
export const FIRST_CONTACT_RUN_AGENT_NAME = 'Rumbo';
/** La ruta vive como mucho 300 s: «en curso» después de esto, Vercel la cortó. */
export const FIRST_CONTACT_RUN_STALE_MS = 6 * 60 * 1000;
/** Lo que el Centro de procesos trae del servidor al abrir la página. */
export const FIRST_CONTACT_RUNS_LIST_HOURS = 24;
export const FIRST_CONTACT_RUNS_LIST_MAX = 12;
export const FIRST_CONTACT_RUN_TIMEOUT_MESSAGE =
  'La preparación se cortó antes de terminar. Revisa la pestaña «Primer contacto» de la empresa y vuelve a intentarlo si falta algo.';
export const FIRST_CONTACT_RUNS_PATH = '/api/agent3/first-call/runs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 200;
const EXPECTED_MAX = 64;

export function isRunId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Lo que el navegador manda junto con la solicitud para registrar la corrida. */
export interface FirstContactRunMeta {
  id: string;
  title: string;
  expected: number;
  accountName: string;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX) : '';
}

/** `body.run` de la solicitud. `null` si no vino o no es válido (la corrida igual se hace). */
export function parseFirstContactRunMeta(body: unknown): FirstContactRunMeta | null {
  const run = (body as { run?: unknown } | null)?.run as Partial<Record<keyof FirstContactRunMeta, unknown>> | null | undefined;
  if (!run || typeof run !== 'object' || !isRunId(run.id)) return null;
  const expected = typeof run.expected === 'number' && Number.isInteger(run.expected) ? Math.min(Math.max(run.expected, 1), EXPECTED_MAX) : 1;
  return { id: run.id.toLowerCase(), title: cleanText(run.title), expected, accountName: cleanText(run.accountName) };
}

/** Una corrida tal como la ve el navegador (sin `detached`, que es de cada pestaña). */
export interface FirstContactServerRun {
  id: string;
  accountId: string;
  accountName: string;
  title: string;
  expected: number;
  status: FirstContactRunStatus;
  startedAtMs: number;
  finishedAtMs: number | null;
  packStatuses: string[];
  message: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function statusFromRow(status: unknown): FirstContactRunStatus {
  if (status === 'completed') return 'succeeded';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'running';
}

function timeMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Una fila de `agent_runs` del Agente 3. `null` si no tiene empresa (no es de este flujo). */
export function mapFirstContactRunRow(row: Record<string, unknown>): FirstContactServerRun | null {
  const input = record(row.input_params);
  const metadata = record(row.metadata);
  const accountId = typeof input.account_id === 'string' ? input.account_id : null;
  const startedAtMs = timeMs(row.started_at) ?? timeMs(row.created_at);
  if (typeof row.id !== 'string' || !accountId || startedAtMs === null) return null;
  const packStatuses = Array.isArray(metadata.pack_statuses) ? metadata.pack_statuses.filter((s): s is string => typeof s === 'string') : [];
  const status = statusFromRow(row.status);
  return {
    id: row.id,
    accountId,
    accountName: typeof metadata.account_name === 'string' && metadata.account_name ? metadata.account_name : 'la empresa',
    title: typeof input.title === 'string' ? input.title : '',
    expected: typeof input.expected === 'number' ? input.expected : 1,
    status,
    startedAtMs,
    finishedAtMs: status === 'running' ? null : timeMs(row.finished_at),
    packStatuses,
    message: status === 'failed' && typeof row.error_message === 'string' ? row.error_message : null,
  };
}

/** ¿El vendedor la quitó del Centro de procesos? (vive en `metadata.dismissed_at`). */
export function isFirstContactRunDismissed(row: Record<string, unknown>): boolean {
  return typeof record(row.metadata).dismissed_at === 'string';
}

/**
 * Agente 3 · el avance de las preparaciones en curso (puro): lo que pide el navegador a
 * `/api/agent3/first-call/live` y cómo se valida.
 */

import type { ResearchProgressStage } from '@/server/agents/first-call/types';
import type { FirstContactServerRun } from './first-contact-run-registry';

export const FIRST_CONTACT_LIVE_PATH = '/api/agent3/first-call/live';
const MAX_ITEMS = 12;

export interface FirstContactLiveItem {
  runId: string;
  accountId: string;
  /** Sólo para las desligadas: desde cuándo buscar sus preparaciones. */
  sinceIso: string | null;
}

export interface FirstContactLiveEntry {
  stage: ResearchProgressStage | null;
  packStatuses: string[] | null;
  /** La corrida en el servidor (`agent_runs`), si quedó registrada: dice cómo terminó. */
  run?: Pick<FirstContactServerRun, 'status' | 'packStatuses' | 'message'> | null;
}

export function parseLiveItems(body: unknown): FirstContactLiveItem[] | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  const parsed: FirstContactLiveItem[] = [];
  for (const raw of items.slice(0, MAX_ITEMS)) {
    const item = raw as Partial<FirstContactLiveItem> | null;
    if (typeof item?.runId !== 'string' || typeof item?.accountId !== 'string') return null;
    parsed.push({
      runId: item.runId.slice(0, 100),
      accountId: item.accountId.slice(0, 100),
      sinceIso: typeof item.sinceIso === 'string' ? item.sinceIso.slice(0, 40) : null,
    });
  }
  return parsed;
}

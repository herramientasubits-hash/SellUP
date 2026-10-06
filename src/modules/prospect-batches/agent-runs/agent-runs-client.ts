'use client';

/**
 * agent-runs-client.ts — el almacén ÚNICO de corridas del navegador y las
 * llamadas por ruta (AGENT1-PARALLEL-RUNS-TRAY-1).
 *
 * Todo va por rutas (`/api/prospect-batches/...`) y no por server actions: el
 * cliente despacha las server actions de una en una y una corrida de hasta 300 s
 * dejaba el resto del chat en cola.
 */

import * as React from 'react';
import type { WizardExecutionActionResult } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-types';
import type {
  ContinueApolloRoundResult,
  PendingApolloContinuationResult,
} from '@/modules/prospect-batches/apollo-continuation-actions';
import { createAgentRunsStore, type AgentRun, type AgentRunPayload, type AgentRunsStore } from './agent-runs-store';
import type { AgentRunStatusSnapshot } from './agent-runs-status.server';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return (await response.json()) as T;
}

export function executeWizardRunViaRoute(payload: AgentRunPayload): Promise<WizardExecutionActionResult> {
  return postJson<WizardExecutionActionResult>('/api/prospect-batches/wizard-runs', payload);
}

export async function fetchAgentRunsStatus(ids: readonly string[]): Promise<AgentRunStatusSnapshot[]> {
  if (ids.length === 0) return [];
  const response = await fetch(`/api/prospect-batches/wizard-runs/status?ids=${ids.map(encodeURIComponent).join(',')}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return ((await response.json()) as { runs: AgentRunStatusSnapshot[] }).runs;
}

/** Mismo contrato que la server action, por ruta. */
export async function findPendingApolloContinuationViaRoute(): Promise<PendingApolloContinuationResult> {
  const response = await fetch('/api/prospect-batches/apollo-continuation', { cache: 'no-store' });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return ((await response.json()) as { pending: PendingApolloContinuationResult }).pending;
}

/** Mismo contrato que la server action, por ruta. */
export async function continueApolloRoundViaRoute(batchId: string): Promise<ContinueApolloRoundResult> {
  return (await postJson<{ outcome: ContinueApolloRoundResult }>('/api/prospect-batches/apollo-continuation', { batchId })).outcome;
}

let singleton: AgentRunsStore | null = null;

/** El almacén del navegador. En el servidor no existe (devuelve `null`). */
export function getAgentRunsStore(): AgentRunsStore | null {
  if (typeof window === 'undefined') return null;
  if (singleton === null) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    singleton = createAgentRunsStore({ execute: executeWizardRunViaRoute, storage });
  }
  return singleton;
}

const EMPTY: readonly AgentRun[] = [];
const noopSubscribe = () => () => {};

export function useAgentRuns(): readonly AgentRun[] {
  const store = getAgentRunsStore();
  return React.useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : () => EMPTY,
    () => EMPTY,
  );
}

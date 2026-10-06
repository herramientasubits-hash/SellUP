import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_RUN_URL_PARAM,
  agentRunHref,
  openAgentRun,
  registerAgentRunOpener,
} from '../agent-run-opener';
import { AGENT_RUNS_TRAY_COPY, processRowAction } from '../agent-runs-tray-copy';
import type { AgentRun } from '@/modules/prospect-batches/agent-runs/agent-runs-store';

describe('abrir una corrida desde el Centro de procesos', () => {
  it('sin drawer montado, navega a Prospectos con la corrida en la URL', () => {
    const visited: string[] = [];
    openAgentRun('abc-1', (href) => visited.push(href));
    assert.deepEqual(visited, [`/accounts?tab=prospectos&${AGENT_RUN_URL_PARAM}=abc-1`]);
  });

  it('con drawer montado, lo abre en la corrida y no navega', () => {
    const opened: string[] = [];
    const visited: string[] = [];
    const unregister = registerAgentRunOpener((id) => opened.push(id));
    openAgentRun('abc-2', (href) => visited.push(href));
    unregister();
    assert.deepEqual(opened, ['abc-2']);
    assert.deepEqual(visited, []);
  });

  it('manda el drawer montado más reciente; al desmontarse, vuelve a navegar', () => {
    const first: string[] = [];
    const second: string[] = [];
    const offFirst = registerAgentRunOpener((id) => first.push(id));
    const offSecond = registerAgentRunOpener((id) => second.push(id));
    openAgentRun('x', () => assert.fail('no debe navegar'));
    offSecond();
    openAgentRun('y', () => assert.fail('no debe navegar'));
    offFirst();
    const visited: string[] = [];
    openAgentRun('z', (href) => visited.push(href));
    assert.deepEqual(first, ['y']);
    assert.deepEqual(second, ['x']);
    assert.deepEqual(visited, [agentRunHref('z')]);
  });
});

describe('botón de cada fila del Centro de procesos (dueña 06-10: «Ver lote» va directo al lote)', () => {
  const base: AgentRun = {
    clientRequestId: 'r1',
    title: 'Ecuador · Tecnología',
    status: 'succeeded',
    createdAtMs: 1,
    startedAtMs: 2,
    finishedAtMs: 3,
    batchId: 'b1',
    redirectPath: '/prospect-batches/b1',
    candidateCount: 9,
    message: null,
    detached: false,
  };

  it('terminada con lote ⇒ al lote, rotulado «Ver lote» (sin abrir el chat)', () => {
    assert.deepEqual(processRowAction(base), { kind: 'batch', href: '/prospect-batches/b1' });
    assert.equal(AGENT_RUNS_TRAY_COPY.openBatch, 'Ver lote');
  });

  it('fallida que dejó empresas ⇒ también al lote', () => {
    assert.deepEqual(processRowAction({ ...base, status: 'failed' }), { kind: 'batch', href: '/prospect-batches/b1' });
  });

  it('en curso, en espera o fallida sin lote ⇒ abre la corrida en el chat (avance o error)', () => {
    assert.deepEqual(processRowAction({ ...base, status: 'running' }), { kind: 'run' });
    assert.deepEqual(processRowAction({ ...base, status: 'queued' }), { kind: 'run' });
    assert.deepEqual(processRowAction({ ...base, status: 'failed', redirectPath: null }), { kind: 'run' });
  });
});

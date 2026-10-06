import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_RUN_URL_PARAM,
  agentRunHref,
  openAgentRun,
  registerAgentRunOpener,
} from '../agent-run-opener';

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

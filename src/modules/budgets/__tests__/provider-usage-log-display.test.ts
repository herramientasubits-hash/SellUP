// Q3F-13S — Tests puros para los helpers de display del Logs tab de proveedor
// (Usuario, Agente, Detalle de error). Sin DB, sin fetch. Solo lógica pura.
// Usa el runner nativo de Node.js (node:test + assert).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTriggeredByDisplay,
  resolveAgentDisplay,
  resolveErrorDetail,
  resolveUsageLogDisplayContext,
  formatUsageLogErrorDetailText,
} from '../provider-usage-log-display';

const FAKE_USER_ID = '11111111-1111-1111-1111-111111111111';
const FAKE_AGENT_RUN_ID = '22222222-2222-2222-2222-222222222222';

describe('resolveTriggeredByDisplay', () => {
  it('shows full name and email when both are resolved', () => {
    const result = resolveTriggeredByDisplay(FAKE_USER_ID, { fullName: 'Ana Ruiz', email: 'ana@ubits.co' });
    assert.deepEqual(result, { primary: 'Ana Ruiz', secondary: 'ana@ubits.co' });
  });

  it('returns explicit unattributed copy for a null triggeredBy', () => {
    const result = resolveTriggeredByDisplay(null, undefined);
    assert.equal(result.primary, 'Sin usuario identificado');
    assert.equal(result.secondary, 'Consumo sin atribución de usuario');
  });

  it('returns explicit unresolved copy for a non-null id with no matching user', () => {
    const result = resolveTriggeredByDisplay(FAKE_USER_ID, undefined);
    assert.equal(result.primary, 'Usuario no disponible');
    assert.equal(result.secondary, null);
  });

  it('never leaks the raw user UUID in null or missing cases', () => {
    const nullCase = resolveTriggeredByDisplay(null, undefined);
    const missingCase = resolveTriggeredByDisplay(FAKE_USER_ID, undefined);
    assert.ok(!nullCase.primary.includes(FAKE_USER_ID));
    assert.ok(!missingCase.primary.includes(FAKE_USER_ID));
    assert.ok(!(missingCase.secondary ?? '').includes(FAKE_USER_ID));
  });

  it('falls back to full name only when email is absent', () => {
    const result = resolveTriggeredByDisplay(FAKE_USER_ID, { fullName: 'Ana Ruiz', email: null });
    assert.deepEqual(result, { primary: 'Ana Ruiz', secondary: null });
  });

  it('falls back to email only when full name is absent', () => {
    const result = resolveTriggeredByDisplay(FAKE_USER_ID, { fullName: null, email: 'ana@ubits.co' });
    assert.deepEqual(result, { primary: 'ana@ubits.co', secondary: null });
  });
});

describe('resolveAgentDisplay', () => {
  it('shows the resolved agent name', () => {
    const result = resolveAgentDisplay(FAKE_AGENT_RUN_ID, { agentKey: 'prospect_generation', agentName: 'Generación de prospectos' });
    assert.equal(result, 'Generación de prospectos');
  });

  it('returns "Manual" for a null agentRunId', () => {
    const result = resolveAgentDisplay(null, undefined);
    assert.equal(result, 'Manual');
  });

  it('returns explicit unresolved copy for a non-null id with no matching agent run', () => {
    const result = resolveAgentDisplay(FAKE_AGENT_RUN_ID, undefined);
    assert.equal(result, 'Agente no disponible');
  });

  it('never leaks the raw agent_run_id in null or missing cases', () => {
    const nullCase = resolveAgentDisplay(null, undefined);
    const missingCase = resolveAgentDisplay(FAKE_AGENT_RUN_ID, undefined);
    assert.ok(!nullCase.includes(FAKE_AGENT_RUN_ID));
    assert.ok(!missingCase.includes(FAKE_AGENT_RUN_ID));
  });

  it('falls back to agent_key when agent_name is null', () => {
    const result = resolveAgentDisplay(FAKE_AGENT_RUN_ID, { agentKey: 'prospect_generation', agentName: null });
    assert.equal(result, 'prospect_generation');
  });
});

describe('resolveErrorDetail', () => {
  it('combines message and code when both are present', () => {
    const result = resolveErrorDetail('Rate limit exceeded', 'rate_limited');
    assert.deepEqual(result, { message: 'Rate limit exceeded', code: 'rate_limited' });
  });

  it('returns message-only detail when code is absent', () => {
    const result = resolveErrorDetail('Rate limit exceeded', null);
    assert.deepEqual(result, { message: 'Rate limit exceeded', code: null });
  });

  it('returns code-only detail when message is absent', () => {
    const result = resolveErrorDetail(null, 'quota_exceeded');
    assert.deepEqual(result, { message: null, code: 'quota_exceeded' });
  });

  it('returns null when neither message nor code is persisted (technical success)', () => {
    const result = resolveErrorDetail(null, null);
    assert.equal(result, null);
  });

  it('does not invent error detail for a successful row', () => {
    // A success row has no error_message/error_code persisted, regardless of status.
    const result = resolveErrorDetail(null, null);
    assert.equal(result, null);
    assert.equal(formatUsageLogErrorDetailText(result), '—');
  });

  it('surfaces persisted rate_limited detail', () => {
    const result = resolveErrorDetail('Too many requests', 'rate_limited');
    assert.equal(formatUsageLogErrorDetailText(result), 'Too many requests (rate_limited)');
  });

  it('surfaces persisted quota_exceeded detail', () => {
    const result = resolveErrorDetail('Monthly quota exceeded', 'quota_exceeded');
    assert.equal(formatUsageLogErrorDetailText(result), 'Monthly quota exceeded (quota_exceeded)');
  });
});

describe('formatUsageLogErrorDetailText', () => {
  it('formats code-only detail without a trailing empty parenthesis', () => {
    const result = resolveErrorDetail(null, 'quota_exceeded');
    assert.equal(formatUsageLogErrorDetailText(result), 'quota_exceeded');
  });

  it('formats null detail as an em dash', () => {
    assert.equal(formatUsageLogErrorDetailText(null), '—');
  });
});

describe('resolveUsageLogDisplayContext', () => {
  it('combines user, agent, and error resolution in one call', () => {
    const context = resolveUsageLogDisplayContext({
      triggeredBy: FAKE_USER_ID,
      resolvedUser: { fullName: 'Ana Ruiz', email: 'ana@ubits.co' },
      agentRunId: FAKE_AGENT_RUN_ID,
      resolvedAgentRun: { agentKey: 'prospect_generation', agentName: 'Generación de prospectos' },
      errorMessage: null,
      errorCode: null,
    });
    assert.deepEqual(context.user, { primary: 'Ana Ruiz', secondary: 'ana@ubits.co' });
    assert.equal(context.agent, 'Generación de prospectos');
    assert.equal(context.errorDetail, null);
  });

  it('combines unattributed user, manual agent, and a persisted error', () => {
    const context = resolveUsageLogDisplayContext({
      triggeredBy: null,
      resolvedUser: undefined,
      agentRunId: null,
      resolvedAgentRun: undefined,
      errorMessage: 'Provider timeout',
      errorCode: 'timeout',
    });
    assert.equal(context.user.primary, 'Sin usuario identificado');
    assert.equal(context.agent, 'Manual');
    assert.deepEqual(context.errorDetail, { message: 'Provider timeout', code: 'timeout' });
  });
});

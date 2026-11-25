import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { archiveAuditDetails, restoreConflictMessage, restoredPipelineStatus } from '../account-restore-core';

describe('«Restaurar empresa»', () => {
  it('vuelve al estado que tenía al archivarla, o a «Nueva»', () => {
    assert.equal(restoredPipelineStatus('ready_for_outreach'), 'ready_for_outreach');
    assert.equal(restoredPipelineStatus('archived'), 'new');
    assert.equal(restoredPipelineStatus(undefined), 'new');
    assert.equal(restoredPipelineStatus('cualquier cosa'), 'new');
  });

  it('archivar guarda el estado previo en la auditoría', () => {
    assert.deepEqual(archiveAuditDetails('research_in_progress'), { previous_pipeline_status: 'research_in_progress' });
    assert.deepEqual(archiveAuditDetails('archived', { bulk: true }), { bulk: true });
    assert.deepEqual(archiveAuditDetails(null), {});
  });

  it('no restaura si la empresa ya tiene otra ficha activa', () => {
    assert.equal(restoreConflictMessage(null), null);
    assert.match(restoreConflictMessage({ id: 'x', name: 'Sportium' }) ?? '', /ya hay una ficha activa.*Sportium/);
  });

  it('restaurar es sólo de admin y no usa un tipo de auditoría que la base rechaza', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../actions.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export async function restoreAccount('));
    const fn = body.slice(0, body.indexOf('\nexport async function') > 0 ? body.indexOf('\n// ====') : undefined);
    assert.match(fn, /requireAdmin\(\)/);
    assert.match(fn, /actionType: 'account_status_changed'/);
    assert.doesNotMatch(fn, /\.delete\(/);
  });
});

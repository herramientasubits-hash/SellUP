// Dueña 14-11 — la IA revisa todo lo rescatable de Descartadas, aunque la búsqueda
// ya tenga sus 10, y un administrador puede lanzarlo a mano para lo que ya estaba.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('rescatar descartadas con IA', () => {
  const action = read('src/modules/prospect-discards/rescue-discarded-actions.ts');

  it('🔴 sólo un administrador activo, con el rescate encendido, antes de leer nada', () => {
    const flag = action.indexOf('isAgent1ClaudeRescueEnabled()');
    const admin = action.indexOf('!isAdmin');
    const read = action.indexOf(".from('prospect_discarded_dispositions')");
    assert.ok(flag > 0 && admin > flag && read > admin);
  });

  it('elige las filas con la misma regla del rescate y lanza cada búsqueda en su función', () => {
    assert.match(action, /needsDispositionRescue\(row, now, domainSearchEnabled\)/);
    assert.match(action, /triggerRescueContinuation\(\{ batchId, continuation: 1, spentUsd: 0, triggeredBy: me\.id \}\)/);
    assert.match(action, /\.eq\('status', 'discarded'\)/);
  });

  it('el botón sólo lo ve un administrador', () => {
    const table = read('src/components/prospects/discarded-prospects-data-table-client.tsx');
    assert.match(table, /\{isAdmin && rows\.length > 0 && <RescueDiscardedButton \/>\}/);
  });

  it('🔴 sin lugar libre en la búsqueda, la descartada igual se revisa', () => {
    const core = read('src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.ts');
    assert.match(core, /if \(!\(await reserveDeliverySlot\(ctx\.slots\)\)\) return rescueDisposition\(row, ctx, deps, admittedIds\);/);
  });
});

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
  const sweep = read('src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-pending-sweep.server.ts');

  it('🔴 sólo un administrador activo, con el rescate encendido, antes de leer nada', () => {
    const flag = action.indexOf('isAgent1ClaudeRescueEnabled()');
    const admin = action.indexOf('!isAdmin');
    const run = action.indexOf('schedulePendingDiscardRescues(');
    assert.ok(flag > 0 && admin > flag && run > admin);
  });

  it('elige las filas con la misma regla del rescate y lanza cada búsqueda en su función', () => {
    assert.match(sweep, /needsDispositionRescue\(row, now, domainSearchEnabled\)/);
    assert.match(sweep, /triggerRescueContinuation\(\{ batchId, continuation: 1, spentUsd: 0, triggeredBy: options\.triggeredBy \}\)/);
    assert.match(sweep, /\.eq\('status', 'discarded'\)/);
  });

  it('🔴 dueña 16-11: el cron diario barre las descartadas de los últimos 3 días sin revisar', () => {
    const cron = read('src/app/api/cron/apollo-round-continuation/route.ts');
    assert.match(cron, /schedulePendingDiscardRescues\(\{ triggeredBy: null, sinceHours: 72 \}\)/);
    // Antes de la bandera de Apollo: corre aunque la continuación esté apagada.
    assert.ok(cron.indexOf('schedulePendingDiscardRescues') < cron.indexOf('isAgent1ApolloCronContinuationEnabled()) {'));
  });

  it('🔴 dueña 16-11: con la búsqueda larga, la segunda vuelta se pide ANTES de responder', () => {
    const schedule = read('src/server/agents/prospecting-toolkit/claude-classifier/rescue/schedule-rescue.server.ts');
    assert.match(
      schedule,
      /if \(computeBackgroundRescueDeadlineMs\(actionStartedAtMs, Date\.now\(\)\) === null\) \{[\s\S]*?await triggerRescueContinuation\(/,
    );
    const wizard = read('src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts');
    assert.match(wizard, /await scheduleClaudeRescueAfterWizardRun\(result, deps\.getActiveUserId, actionStartedAtMs\);/);
  });

  it('🔴 dueña 16-11: la capa gratuita de la cascada descuenta lo que el lote ya entregó', () => {
    const lusha = read('src/modules/prospect-batches/lusha-pending-review-actions.ts');
    assert.match(lusha, /runPrePaidNoveltyDiscovery\(await createClient\(\), \{\s*alreadyDeliveredInBatch,/);
  });

  it('el botón sólo lo ve un administrador', () => {
    const table = read('src/components/prospects/discarded-prospects-data-table-client.tsx');
    assert.match(table, /\{isAdmin && rows\.length > 0 && <RescueDiscardedButton \/>\}/);
  });

  it('🔴 sin lugar libre en la búsqueda, la descartada igual se revisa y lo que pasa va al banco', () => {
    const core = read('src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.ts');
    assert.match(core, /if \(!\(await reserveDeliverySlot\(ctx\.slots\)\)\) return rescueDisposition\(row, ctx, deps, admittedIds, \{ overCap: true \}\);/);
    assert.match(core, /if \(goesBack && options\.overCap && decision\.kind === 'admit'\) \{\s*return bankOverCapDisposition\(/);
    const server = read('src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.server.ts');
    assert.match(server, /depositToBank: async \(item\) => \{[\s\S]*?port\.store\.deposit\(\[item\]\)/);
  });

  it('la que se fue al banco no aparece en Descartadas', () => {
    const queries = read('src/modules/prospect-discards/queries.ts');
    assert.match(queries, /\.or\('evidence->claude_rescue->>banked\.is\.null,evidence->claude_rescue->>banked\.neq\.true'\)/);
  });
});

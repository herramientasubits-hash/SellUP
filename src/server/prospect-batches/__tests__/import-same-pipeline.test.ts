/**
 * Tests — AGENT1-IMPORT-SAME-PIPELINE-1: la importación pasa por lo mismo que el
 * Agente 1 (tamaño oficial con el mismo umbral, rescate con Claude después).
 *
 * Puro + guardas estáticas. Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { IMPORT_ICP_MIN_EMPLOYEES, resolveImportIcpSize } from '../import-icp-size';

const officialWith = (workers: number) => ({
  strongIdentityAvailable: true,
  metadata: { workforce: { workers, year: new Date().getFullYear(), source: 'cl_sii_registry' } } as never,
});

describe('resolveImportIcpSize — mismo umbral y jerarquía que el escritor del Agente 1', () => {
  it('umbral = 200, como el escritor', () => {
    assert.equal(IMPORT_ICP_MIN_EMPLOYEES, 200);
  });

  it('registro oficial con 40 trabajadores ⇒ Descartadas, con motivo «registro oficial»', () => {
    const v = resolveImportIcpSize({ companySize: null, official: officialWith(40) });
    assert.equal(v.discard, true);
    assert.equal(v.gate.decision, 'block');
    assert.match(v.discardNote ?? '', /registro oficial/);
  });

  it('registro oficial con 900 trabajadores ⇒ queda en revisión con tamaño confirmado', () => {
    const v = resolveImportIcpSize({ companySize: null, official: officialWith(900) });
    assert.equal(v.discard, false);
    assert.equal(v.gate.decision, 'pass');
  });

  it('identidad oficial débil ⇒ su tamaño NO se usa', () => {
    const v = resolveImportIcpSize({
      companySize: null,
      official: { strongIdentityAvailable: false, metadata: officialWith(40).metadata },
    });
    assert.equal(v.discard, false);
    assert.equal(v.gate.size_status, 'unknown');
  });

  it('archivo dice «11-50» ⇒ Descartadas, con motivo «archivo»', () => {
    const v = resolveImportIcpSize({ companySize: '11-50', official: null });
    assert.equal(v.discard, true);
    assert.match(v.discardNote ?? '', /archivo/);
  });

  it('sin tamaño en ningún lado ⇒ revisión con tamaño desconocido (lo averigua el rescate)', () => {
    const v = resolveImportIcpSize({ companySize: null, official: null });
    assert.equal(v.discard, false);
    assert.equal(v.gate.size_status, 'unknown');
  });
});

function code(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('cableado de la importación (guardas estáticas)', () => {
  const route = code('src/app/api/prospect-batches/create-import-batch/route.ts');
  const schedule = code('src/server/agents/prospecting-toolkit/claude-classifier/rescue/schedule-rescue.server.ts');
  const rescueDeps = code('src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.server.ts');

  it('la fila pequeña entra como discarded y guarda icp_size_gate', () => {
    assert.match(route, /icpSize\.discard \? 'discarded' : 'needs_review'/);
    assert.match(route, /icp_size_gate: \{ \.\.\.icpSize\.gate/);
  });

  it('sólo las filas en revisión reclaman la empresa', () => {
    assert.match(route, /candidateStatus === 'needs_review'\) createdCandidateIds\.push/);
  });

  it('la importación agenda el rescate de Claude después del enriquecimiento', () => {
    assert.match(route, /scheduleClaudeRescueAfterImport\(\{/);
    assert.match(route, /before: drainBeforeRescue/);
    assert.match(schedule, /if \(params\.before\)[\s\S]*runFirstRescueRound\(params\.batchId/);
  });

  it('el rescate respeta su interruptor (ENABLE_AGENT1_CLAUDE_RESCUE)', () => {
    assert.match(schedule, /const rescue = isAgent1ClaudeRescueEnabled\(\) && params\.hasReviewRows/);
  });

  it('las vueltas siguientes tratan el lote importado como «sin completitud»', () => {
    assert.match(rescueDeps, /batch\?\.source === 'external_import'/);
  });
});

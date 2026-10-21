/**
 * AGENT1-CRITERIA-QUICK-WINS-1 § 6 — un lote cerrado sólo con la capa gratuita
 * recibe nombre humano y fecha de cierre en su sellado terminal.
 * Sin Supabase real.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildFreeOnlyBatchName, resolveFreeOnlyBatchName } from '../free-only-terminal-publication';

const NOW = new Date('2026-10-21T15:00:00Z');

describe('resolveFreeOnlyBatchName', () => {
  it('reemplaza el rótulo provisional por el formato del writer de pago', () => {
    const name = resolveFreeOnlyBatchName(
      { name: 'Wizard: c1000001-0000-0000-0000-000000000001 / CO', country: 'Colombia', industry: 'Tecnología' },
      NOW,
    );
    assert.equal(name, buildFreeOnlyBatchName('Colombia', 'Tecnología', NOW));
    assert.match(name ?? '', /^Agente 1 · Pipeline · Colombia · Tecnología · /);
  });

  it('respeta cualquier nombre que no sea el provisional', () => {
    for (const existing of ['Proveedores de Éxito · Colombia · Retail', 'Mi lote', 'Agente 1 · Pipeline · Perú · Salud · 1 oct 2026']) {
      assert.equal(resolveFreeOnlyBatchName({ name: existing, country: 'Colombia', industry: 'Retail' }, NOW), null);
    }
  });

  it('sin país o industria no inventa un nombre', () => {
    assert.equal(resolveFreeOnlyBatchName({ name: 'Wizard: x / CO', country: '', industry: 'Retail' }, NOW), null);
    assert.equal(resolveFreeOnlyBatchName({ name: 'Wizard: x / CO', country: 'Colombia', industry: null }, NOW), null);
  });
});

describe('sellado gratuito (estático)', () => {
  const src = readFileSync(
    path.join(process.cwd(), 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts'),
    'utf8',
  );
  it('el sellado escribe nombre y `completed_at` en la misma escritura terminal', () => {
    const start = src.indexOf('sealFreeOnlyBatchStatus: async');
    const block = src.slice(start, src.indexOf('runTavilyPipeline:', start));
    assert.match(block, /resolveFreeOnlyBatchName\(/);
    assert.match(block, /decideBatchCompletionSeal\(/);
    assert.match(block, /completed_at: completionSeal\.completedAt/);
    // Sin metadata sigue siendo el sellado acotado de siempre (sólo estado); con
    // metadata, nombre y fecha viajan en esa MISMA escritura terminal.
    assert.match(block, /\.update\(\{ status \}\)/);
    assert.equal((block.match(/\.update\(/g) ?? []).length, 2, 'acotado + terminal, ninguna más');
  });
});

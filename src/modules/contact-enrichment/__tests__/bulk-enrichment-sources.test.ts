/**
 * «Buscar contactos de las aprobadas»: desde una búsqueda de prospectos se abre la
 * búsqueda masiva de contactos con las empresas que esa búsqueda ya creó. Sólo para
 * quien puede buscar en masa, y la corrida recuerda de qué búsqueda salió.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectConvertedAccountIds, parseBulkEnrichmentOrigin } from '../bulk-enrichment-sources-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..', '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

describe('collectConvertedAccountIds', () => {
  it('sólo las convertidas con empresa, sin repetir y en orden', () => {
    assert.deepEqual(
      collectConvertedAccountIds([
        { status: 'converted_to_account', converted_account_id: 'a1' },
        { status: 'needs_review', converted_account_id: null },
        { status: 'converted_to_account', converted_account_id: 'a2' },
        { status: 'converted_to_account', converted_account_id: 'a1' },
        { status: 'converted_to_account', converted_account_id: null },
      ]),
      ['a1', 'a2'],
    );
  });

  it('una revertida (vuelve a approved con el id) no cuenta', () => {
    assert.deepEqual(collectConvertedAccountIds([{ status: 'approved', converted_account_id: 'a1' }]), []);
  });
});

describe('parseBulkEnrichmentOrigin', () => {
  it('acepta sólo una búsqueda de prospectos con id', () => {
    assert.deepEqual(parseBulkEnrichmentOrigin({ kind: 'prospect_batch', batchId: ' b1 ' }), {
      kind: 'prospect_batch',
      batchId: 'b1',
    });
    for (const bad of [null, undefined, 'b1', {}, { kind: 'otro', batchId: 'b1' }, { kind: 'prospect_batch', batchId: '' }]) {
      assert.equal(parseBulkEnrichmentOrigin(bad), null);
    }
  });
});

describe('cableado', () => {
  it('la acción exige la capacidad de Growth y el alcance antes de leer', () => {
    const action = read('modules/contact-enrichment/bulk-enrichment-sources.ts');
    const gate = action.indexOf("checkCapability('enriquecerMasivo')");
    const scope = action.indexOf('isBatchInScope(batchId)');
    const firstRead = action.indexOf(".from('prospect_candidates')");
    assert.ok(gate > 0 && scope > gate && firstRead > scope);
    assert.ok(action.includes(".is('archived_at', null)"));
  });

  it('la búsqueda y Empresas › Búsquedas sólo ofrecen el botón con la capacidad', () => {
    const batchPage = read('app/(sellup)/prospect-batches/[batchId]/page.tsx');
    assert.ok(batchPage.includes("checkCapability('enriquecerMasivo')"));
    assert.ok(batchPage.includes('bulkEnrich.ok && counts.converted > 0 && ('));
    const searchesPanel = read('components/searches/searches-panel.tsx');
    assert.ok(searchesPanel.includes("checkCapability('enriquecerMasivo')"));
    assert.ok(searchesPanel.includes('canEnrichBulk={enrichBulk}'));
    const table = read('components/searches/searches-table-client.tsx');
    assert.ok(table.includes('...(canEnrichBulk'));
    assert.ok(table.includes('row.original.converted > 0 ? ('));
  });

  it('la corrida guarda de qué búsqueda salió', () => {
    const drawer = read('components/contact-enrichment/bulk-contact-enrichment-drawer.tsx');
    assert.ok(drawer.includes('createBulkContactEnrichmentRunAction(accountIds, { origin })'));
    const actions = read('modules/contact-enrichment/actions.ts');
    const fn = actions.slice(actions.indexOf('export async function createBulkContactEnrichmentRunAction('));
    assert.ok(fn.includes('parseBulkEnrichmentOrigin(options.origin)'));
    assert.ok(fn.includes("...(origin ? { origin } : {})"));
  });
});

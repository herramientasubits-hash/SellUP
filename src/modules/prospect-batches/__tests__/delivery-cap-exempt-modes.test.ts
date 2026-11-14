// Dueña 14-11 — el tope de 10 por búsqueda es de «Empresas por criterios»: Árbol,
// Competidores y Proveedores entregan todo lo que encuentran.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isDeliveryCapExemptBatch } from '../delivery-cap';

const root = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('qué búsquedas no tienen el tope de 10', () => {
  it('Árbol, Competidores y Proveedores; criterios sí lo tienen', () => {
    assert.equal(isDeliveryCapExemptBatch({ search_mode: 'corporate_tree', corporate_tree: {} }), true);
    assert.equal(isDeliveryCapExemptBatch({ search_mode: 'company_bank_first', competitor_search: { name: 'X' } }), true);
    assert.equal(isDeliveryCapExemptBatch({ supplier_search: { reference_company_name: 'Y' } }), true);
    assert.equal(isDeliveryCapExemptBatch({ search_mode: 'competitors' }), true);
    assert.equal(isDeliveryCapExemptBatch({ search_mode: 'apollo_two_round_adaptive' }), false);
    assert.equal(isDeliveryCapExemptBatch(null), false);
  });
});

describe('cableado: cada camino de esos modos escribe sin tope', () => {
  it('Competidores: Apollo, banco, HubSpot libre y capa gratuita', () => {
    assert.match(read('src/server/prospect-batches/competitor-search/competitor-apollo.server.ts'), /maxDeliveredCandidates: null,/);
    const free = read('src/server/prospect-batches/competitor-search/competitor-free-sources.server.ts');
    assert.match(free, /resolveProductionBankFirstDrawer\(input\.industryName, \{ reviewInline: false, uncapped: true \}\)/);
    assert.match(free, /resolveProductionHubSpotFreePoolDrawer\(input\.industryName, \{ reviewInline: false, uncapped: true \}\)/);
    assert.match(free, /partialGapSupported: true,\s*uncapped: true,/);
  });

  it('la ronda de la IA (Proveedores y Competidores) escribe sin tope', () => {
    assert.match(
      read('src/server/agents/prospecting-toolkit/claude-classifier/company-search-run.ts'),
      /\.\.\.\(referenceCompanyName \|\| source\.competitorReference \? \{ uncapped: true \} : \{\}\)/,
    );
    assert.match(
      read('src/server/agents/prospecting-toolkit/claude-classifier/company-search-run.server.ts'),
      /maxDeliveredCandidates: uncapped \? null : resolveMaxDeliveredCandidates\(\)/,
    );
  });

  it('el árbol sigue sin tope y el rescate no cuenta lugares en estos modos', () => {
    assert.match(read('src/server/prospect-batches/corporate-tree/corporate-tree-run.server.ts'), /maxDeliveredCandidates: null,/);
    assert.match(
      read('src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.server.ts'),
      /if \(isDeliveryCapExemptBatch\(\(batch as \{ metadata\?: unknown \} \| null\)\?\.metadata\)\) return null;/,
    );
  });
});

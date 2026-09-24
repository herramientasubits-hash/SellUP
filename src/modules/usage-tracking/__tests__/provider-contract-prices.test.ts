/**
 * AGENT1-PROVIDER-CONTRACT-PRICES-1 — el precio por crédito ES el contrato.
 *
 * Los precios anteriores (Apollo 0,00875 = 4.200/480.000; Lusha 0,08823529 =
 * 3.600/40.800) venían de supuestos. Estas pruebas fijan que cada constante sale
 * de su contrato anual, y que el código que no lee `provider_pricing_config`
 * usa la constante y no un número escrito a mano.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { APOLLO_CONTRACT, LUSHA_CONTRACT } from '../provider-contract-prices';

const round8 = (n: number) => Math.round(n * 1e8) / 1e8;

describe('precio por crédito = USD anual ÷ créditos anuales', () => {
  it('Apollo: 4.200 / 484.335 = 0,00867168', () => {
    assert.equal(
      APOLLO_CONTRACT.usdPerCredit,
      round8(APOLLO_CONTRACT.annualUsd / APOLLO_CONTRACT.annualCredits),
    );
    assert.equal(APOLLO_CONTRACT.usdPerCredit, 0.00867168);
  });

  it('Lusha: 4.174,57 / 61.200 = 0,06821193', () => {
    assert.equal(
      LUSHA_CONTRACT.usdPerCredit,
      round8(LUSHA_CONTRACT.annualUsd / LUSHA_CONTRACT.annualCredits),
    );
    assert.equal(LUSHA_CONTRACT.usdPerCredit, 0.06821193);
  });
});

describe('ningún precio viejo escrito a mano', () => {
  const root = path.resolve(__dirname, '../../../..');
  const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

  it('el costo de organizations_search usa la constante del contrato', () => {
    const source = read(
      'src/server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider.ts',
    );
    assert.match(
      source,
      /const APOLLO_ORGANIZATIONS_UNIT_COST_USD = APOLLO_CONTRACT\.usdPerCredit;/,
    );
  });

  it('el registro de proveedores lleva el precio del contrato para Apollo', () => {
    const source = read('src/modules/prospect-batches/provider-routing/provider-registry.ts');
    // El registro es puro (sólo importa de su carpeta): lleva el literal, que
    // debe ser EXACTAMENTE el del contrato.
    assert.ok(source.includes(`unitCostUsd: ${APOLLO_CONTRACT.usdPerCredit},`));
    assert.equal(source.includes('0.00875'), false);
  });

  it('los planes de demostración ya no citan los supuestos viejos', () => {
    const source = read('src/modules/usage-tracking/mock-data.ts');
    for (const old of ['480000', '40800', '3600 / 40800', '0.08823529']) {
      assert.equal(source.includes(old), false, `aparece ${old}`);
    }
  });
});

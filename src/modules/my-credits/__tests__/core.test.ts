/** «Mis créditos» — núcleo puro de las filas del menú de cuenta. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMyCreditsRow,
  buildMyCreditsRows,
  sumOwnUsage,
  toneForPercent,
  type MyCreditsProviderInput,
  type MyCreditsRuleInput,
} from '../core';

const NO_OWN = { credits: 0, usd: 0, rows: 0 };

function rule(overrides: Partial<MyCreditsRuleInput> = {}): MyCreditsRuleInput {
  return {
    scope: 'user',
    periodType: 'monthly',
    limitCredits: 100,
    limitUsd: null,
    onExceed: 'block',
    balance: { base: 100, topUps: 0, grantsForUser: 0, carriedIn: 0 },
    poolCredits: 38,
    poolUsd: 2.6,
    ...overrides,
  };
}

function input(overrides: Partial<MyCreditsProviderInput> = {}): MyCreditsProviderInput {
  return { providerKey: 'lusha', displayName: 'Lusha', rule: rule(), own: NO_OWN, ...overrides };
}

describe('toneForPercent', () => {
  it('74 normal · 75 aviso · 99 aviso · 100 rojo', () => {
    assert.equal(toneForPercent(74), 'normal');
    assert.equal(toneForPercent(74.99), 'normal');
    assert.equal(toneForPercent(75), 'warning');
    assert.equal(toneForPercent(99.9), 'warning');
    assert.equal(toneForPercent(100), 'danger');
    assert.equal(toneForPercent(130), 'danger');
    assert.equal(toneForPercent(null), 'normal');
  });
});

describe('buildMyCreditsRow', () => {
  it('regla personal en créditos: consumo / límite, sin línea de equipo', () => {
    const row = buildMyCreditsRow(input())!;
    assert.equal(row.unit, 'credits');
    assert.equal(row.used, 38);
    assert.equal(row.limit, 100);
    assert.equal(row.percent, 38);
    assert.equal(row.tone, 'normal');
    assert.equal(row.shared, false);
    assert.equal(row.ownUsed, null);
    assert.equal(row.exhausted, false);
  });

  it('una fuente con límite aparece aunque la persona no haya gastado nada', () => {
    const row = buildMyCreditsRow(input({ rule: rule({ poolCredits: 0 }) }))!;
    assert.equal(row.used, 0);
    assert.equal(row.percent, 0);
  });

  it('regla de grupo: la barra es del pozo y aparece «tú usaste»', () => {
    const row = buildMyCreditsRow(
      input({ rule: rule({ scope: 'group', poolCredits: 412, limitCredits: 500 }), own: { credits: 120, usd: 1, rows: 9 } }),
    )!;
    assert.equal(row.shared, true);
    assert.equal(row.used, 412);
    assert.equal(row.ownUsed, 120);
    assert.equal(row.tone, 'warning');
  });

  it('regla solo en USD: se muestra en USD con barra', () => {
    const row = buildMyCreditsRow(
      input({ providerKey: 'anthropic', rule: rule({ limitCredits: null, limitUsd: 10, poolUsd: 3.2, balance: null }) }),
    )!;
    assert.equal(row.unit, 'usd');
    assert.equal(row.used, 3.2);
    assert.equal(row.limit, 10);
    assert.equal(Math.round(row.percent!), 32);
    assert.equal(row.extras, null);
  });

  it('el límite vigente ya incluye lo aprobado y el saldo anterior, y se explica', () => {
    const row = buildMyCreditsRow(
      input({ rule: rule({ limitCredits: 150, balance: { base: 100, topUps: 0, grantsForUser: 20, carriedIn: 30 } }) }),
    )!;
    assert.equal(row.limit, 150);
    assert.deepEqual(row.extras, { grantsForUser: 20, carriedIn: 30, topUps: 0 });
  });

  it('llegar al límite marca «sin créditos» y conserva qué pasa al exceder', () => {
    const row = buildMyCreditsRow(input({ rule: rule({ poolCredits: 100, onExceed: 'require_approval' }) }))!;
    assert.equal(row.exhausted, true);
    assert.equal(row.tone, 'danger');
    assert.equal(row.onExceed, 'require_approval');
  });

  it('límite 0: sin créditos desde el inicio', () => {
    const row = buildMyCreditsRow(input({ rule: rule({ limitCredits: 0, poolCredits: 0 }) }))!;
    assert.equal(row.exhausted, true);
    assert.equal(row.percent, 100);
  });

  it('sin regla pero con consumo (IA incluida): solo el consumo, sin barra', () => {
    const credits = buildMyCreditsRow(input({ providerKey: 'tavily', rule: null, own: { credits: 45, usd: 0, rows: 45 } }))!;
    assert.equal(credits.limit, null);
    assert.equal(credits.percent, null);
    assert.equal(credits.used, 45);
    assert.equal(credits.unit, 'credits');

    const ai = buildMyCreditsRow(input({ providerKey: 'anthropic', rule: null, own: { credits: 0, usd: 1.75, rows: 12 } }))!;
    assert.equal(ai.unit, 'usd');
    assert.equal(ai.used, 1.75);
  });

  it('sin regla y sin consumo: no aparece', () => {
    assert.equal(buildMyCreditsRow(input({ rule: null, own: NO_OWN })), null);
  });

  it('regla sin ningún límite se trata como «sin límite»', () => {
    assert.equal(buildMyCreditsRow(input({ rule: rule({ limitCredits: null, limitUsd: null }), own: NO_OWN })), null);
    const row = buildMyCreditsRow(
      input({ rule: rule({ limitCredits: null, limitUsd: null }), own: { credits: 5, usd: 0, rows: 5 } }),
    )!;
    assert.equal(row.limit, null);
  });
});

describe('buildMyCreditsRows — orden', () => {
  it('primero Lusha y Apollo; luego de mayor a menor %; sin límite al final', () => {
    const rows = buildMyCreditsRows([
      input({ providerKey: 'tavily', displayName: 'Tavily', rule: null, own: { credits: 3, usd: 0, rows: 3 } }),
      input({ providerKey: 'anthropic', displayName: 'Anthropic', rule: rule({ limitCredits: null, limitUsd: 10, poolUsd: 9 }) }),
      input({ providerKey: 'apollo', displayName: 'Apollo', rule: rule({ poolCredits: 10 }) }),
      input({ providerKey: 'openai', displayName: 'OpenAI', rule: rule({ limitCredits: null, limitUsd: 10, poolUsd: 1 }) }),
      input({ providerKey: 'lusha', displayName: 'Lusha', rule: rule({ poolCredits: 5 }) }),
    ]);
    assert.deepEqual(rows.map((r) => r.providerKey), ['lusha', 'apollo', 'anthropic', 'openai', 'tavily']);
  });
});

describe('sumOwnUsage', () => {
  it('NULL no suma (nunca se inventa una cifra) pero la fila sí cuenta como uso', () => {
    assert.deepEqual(
      sumOwnUsage([
        { creditsUsed: 2, estimatedCostUsd: 0.5 },
        { creditsUsed: null, estimatedCostUsd: null },
        { creditsUsed: 1, estimatedCostUsd: null },
      ]),
      { credits: 3, usd: 0.5, rows: 3 },
    );
  });
});

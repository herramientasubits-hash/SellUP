/**
 * WS6 — exclusiones, memoria provider-seen por país, liquidación y firma de
 * Lusha, conciliación de operaciones muertas y topes de tiempo.
 *
 *   F5 — las cuentas de OTRA macro no ocupan la lista de exclusión de Apollo.
 *   A  — la memoria provider-seen se llena con lo visto en ESTE país.
 *   F6 — la liquidación cuenta el importe contractual de páginas sin importe.
 *   F10— la firma distingue consulta con y sin exclusión de dominios.
 *   D  — una operación sin resolver de más de 24 h se cierra y se vuelve a
 *        reclamar; una reciente sigue bloqueando.
 *   E  — una página corta cierra la rama; `already_reserved` sobre una reserva
 *        liquidada no ejecuta.
 *   F  — el tope de tiempo de una operación vence como `TimeoutError`.
 *
 * Offline por construcción: sin red, sin Supabase (dobles en memoria).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { filterAccountsToRunMacro } from '../country-source-discovery/prepaid-novelty-gate.server';
import {
  createSupabaseProviderSeenStore,
  PROVIDER_SEEN_SCOPED_SCAN_PAGES,
} from '../provider-seen/provider-seen-supabase-store';
import { decideLushaUsageCredits } from '../lusha-provider-usage-observability';
import {
  decideLushaCreditsToConfirm,
  guardLushaRunBudget,
  LUSHA_BUDGET_RESERVATION_SETTLED_ERROR,
} from '@/modules/prospect-batches/lusha-budget-gate';
import {
  buildLushaOperationSignaturePayload,
  computeLushaOperationSignatureHash,
  LUSHA_DOMAIN_EXCLUSION_SIGNATURE_VERSION,
  LUSHA_OPERATION_STALE_AFTER_MS,
  resolveLushaProspectingOperation,
  type LushaProspectingOperationStore,
} from '../lusha-prospecting-operation';
import { decidePaidPageContinuation } from '@/modules/prospect-batches/prepaid-novelty/paid-page-novelty-continuation';
import {
  raceApolloOperationTimeout,
  APOLLO_OPERATION_MIN_TIMEOUT_MS,
} from '@/server/agents/prospecting-toolkit/apollo-organizations-operation-timeout';

// ─── F5 ───────────────────────────────────────────────────────────────────────

describe('WS6 · F5 — exclusión de Apollo con alcance de industria', () => {
  const rows = [
    { domain: 'a-retail.co', industry: 'Retail' },
    { domain: 'b-tech.co', industry: 'Tecnología' },
    { domain: 'c-sin.co', industry: null },
    { domain: 'd-rara.co', industry: 'algo que no es una macro' },
    { domain: 'e-tech.co', industry: 'technology' },
  ];

  it('con macro conocida: fuera las de OTRA macro; misma macro primero, luego desconocidas', () => {
    assert.deepEqual(filterAccountsToRunMacro(rows, 'technology'), [
      'b-tech.co',
      'e-tech.co',
      'c-sin.co',
      'd-rara.co',
    ]);
  });

  it('sin macro: todas, en el orden de lectura (comportamiento previo)', () => {
    assert.deepEqual(
      filterAccountsToRunMacro(rows, null),
      rows.map((row) => row.domain),
    );
  });

  it('con macro conocida, una lista de solo otra industria deja la exclusión vacía de cuentas', () => {
    assert.deepEqual(
      filterAccountsToRunMacro(
        [
          { domain: 'x-retail.co', industry: 'Retail' },
          { domain: 'y-salud.co', industry: 'Salud & Farmacéuticos' },
        ],
        'technology',
      ),
      [],
    );
  });
});

// ─── A ────────────────────────────────────────────────────────────────────────

type Row = {
  provider: string;
  provider_entity_type: string;
  provider_entity_id: string | null;
  normalized_domain: string | null;
  first_seen_at: string;
  last_seen_at: string;
  first_seen_correlation: string | null;
  last_seen_correlation: string | null;
};

const BATCH_CO = '11111111-1111-4111-8111-111111111111';
const BATCH_MX = '22222222-2222-4222-8222-222222222222';

function seenRow(index: number, correlation: string | null): Row {
  return {
    provider: 'apollo',
    provider_entity_type: 'company',
    provider_entity_id: `id_${index}`,
    normalized_domain: `dominio-${index}.com`,
    first_seen_at: '2026-10-01T00:00:00.000Z',
    last_seen_at: '2026-10-01T00:00:00.000Z',
    first_seen_correlation: correlation,
    last_seen_correlation: correlation,
  };
}

function scopedClientDouble(rows: Row[], batches: Record<string, string>) {
  const rangeCalls: Array<[number, number]> = [];
  const client = {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select: () => ({
            in: async (_column: string, ids: string[]) => ({
              data: ids.filter((id) => batches[id]).map((id) => ({ id, country_code: batches[id] })),
              error: null,
            }),
          }),
        };
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        range: async (from: number, to: number) => {
          rangeCalls.push([from, to]);
          return { data: rows.slice(from, to + 1), error: null };
        },
        limit: async () => {
          throw new Error('la carga con alcance no usa limit()');
        },
      };
      return builder;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  return { client: client as unknown as SupabaseClient, rangeCalls };
}

describe('WS6 · A — memoria provider-seen con alcance de país', () => {
  it('lo de otro país no desplaza la memoria de éste: sigue leyendo hasta llenar el tope', async () => {
    // 4 filas recientes de México y, detrás, 4 de Colombia + 1 sin lote.
    const rows = [
      ...[0, 1, 2, 3].map((i) => seenRow(i, BATCH_MX)),
      ...[4, 5, 6, 7].map((i) => seenRow(i, BATCH_CO)),
      seenRow(8, 'no-es-un-lote'),
    ];
    const { client, rangeCalls } = scopedClientDouble(rows, { [BATCH_CO]: 'CO', [BATCH_MX]: 'MX' });
    const records = await createSupabaseProviderSeenStore(client).load({
      provider: 'apollo',
      limit: 4,
      scope: { countryCode: 'co' },
    });
    assert.deepEqual(
      records.map((r) => r.providerEntityId),
      ['id_4', 'id_5', 'id_6', 'id_7'],
    );
    assert.ok(rangeCalls.length >= 2, 'tuvo que pasar de la primera página');
    assert.ok(rangeCalls.length <= PROVIDER_SEEN_SCOPED_SCAN_PAGES);
  });

  it('correlación que no es un lote o lote ilegible ⇒ la fila se CONSERVA', async () => {
    const rows = [seenRow(0, 'no-es-un-lote'), seenRow(1, '33333333-3333-4333-8333-333333333333'), seenRow(2, null)];
    const { client } = scopedClientDouble(rows, {});
    const records = await createSupabaseProviderSeenStore(client).load({
      provider: 'apollo',
      limit: 10,
      scope: { countryCode: 'CO' },
    });
    assert.equal(records.length, 3);
  });
});

// ─── F6 ───────────────────────────────────────────────────────────────────────

describe('WS6 · F6 — liquidación de Lusha con páginas sin importe', () => {
  it('la decisión de uso liquida con el importe de liquidación, y reporta lo de Lusha', () => {
    const decision = decideLushaUsageCredits({
      creditsReserved: 6,
      creditsChargedTotal: 1,
      creditsForSettlement: 2,
      settlement: { status: 'confirmed' } as never,
      decideCreditsToConfirm: decideLushaCreditsToConfirm,
    });
    assert.equal(decision.creditsUsed, 2, 'página 0 reportó 1 + página 1 indeterminada = 2');
    assert.equal(decision.providerReportedCredits, 1, 'lo reportado no se infla');
  });

  it('sin importe de liquidación ⇒ comportamiento previo', () => {
    const decision = decideLushaUsageCredits({
      creditsReserved: 6,
      creditsChargedTotal: 1,
      settlement: { status: 'confirmed' } as never,
      decideCreditsToConfirm: decideLushaCreditsToConfirm,
    });
    assert.equal(decision.creditsUsed, 1);
  });
});

// ─── F10 ──────────────────────────────────────────────────────────────────────

describe('WS6 · F10 — la firma distingue la exclusión de dominios', () => {
  const base = { countryCode: 'CO', macroIndustryKey: 'technology' };

  it('sin exclusión la carga canónica no cambia (las firmas existentes siguen valiendo)', () => {
    const payload = buildLushaOperationSignaturePayload({ ...base, domainExclusionVersion: null });
    assert.ok(!('domainExclusionVersion' in payload));
    assert.equal(
      computeLushaOperationSignatureHash({ ...base, domainExclusionVersion: null }),
      computeLushaOperationSignatureHash(base),
    );
  });

  it('con exclusión la firma es otra: el cursor no hereda el historial sin filtro', () => {
    assert.notEqual(
      computeLushaOperationSignatureHash({
        ...base,
        domainExclusionVersion: LUSHA_DOMAIN_EXCLUSION_SIGNATURE_VERSION,
      }),
      computeLushaOperationSignatureHash(base),
    );
  });
});

// ─── D ────────────────────────────────────────────────────────────────────────

describe('WS6 · D — operaciones sin resolver muertas', () => {
  function storeDouble(expireStatus: 'expired' | 'not_stale' | 'failed') {
    const calls: string[] = [];
    let claims = 0;
    const store: LushaProspectingOperationStore = {
      claimOrResume: async () => {
        claims++;
        calls.push('claim');
        return claims === 1 || expireStatus !== 'expired'
          ? { status: 'resumed_unresolved', operationId: 'op-viejo', state: 'reconciliation_required' }
          : { status: 'created', operationId: 'op-nuevo' };
      },
      complete: async () => ({ status: 'completed' }),
      expireStaleUnresolved: async ({ createdBefore }) => {
        calls.push(`expire:${createdBefore}`);
        return { status: expireStatus };
      },
    };
    return { store, calls };
  }
  const NOW = Date.parse('2026-10-16T12:00:00.000Z');

  it('vieja (> 24 h) ⇒ se cierra y se vuelve a reclamar UNA vez', async () => {
    const { store, calls } = storeDouble('expired');
    const result = await resolveLushaProspectingOperation({
      store,
      internalUserId: '44444444-4444-4444-8444-444444444444',
      criteria: { countryCode: 'CO', macroIndustryKey: 'technology' },
      clientRequestId: null,
      now: () => NOW,
    });
    assert.equal(result.status, 'authorized');
    assert.deepEqual(calls, [
      'claim',
      `expire:${new Date(NOW - LUSHA_OPERATION_STALE_AFTER_MS).toISOString()}`,
      'claim',
    ]);
  });

  it('reciente ⇒ sigue bloqueando', async () => {
    const { store } = storeDouble('not_stale');
    const result = await resolveLushaProspectingOperation({
      store,
      internalUserId: '44444444-4444-4444-8444-444444444444',
      criteria: { countryCode: 'CO', macroIndustryKey: 'technology' },
      clientRequestId: null,
      now: () => NOW,
    });
    assert.equal(result.status, 'blocked');
  });

  it('fallo al cerrar ⇒ bloquea (fail-closed)', async () => {
    const { store } = storeDouble('failed');
    const result = await resolveLushaProspectingOperation({
      store,
      internalUserId: '44444444-4444-4444-8444-444444444444',
      criteria: { countryCode: 'CO', macroIndustryKey: 'technology' },
      clientRequestId: null,
      now: () => NOW,
    });
    assert.equal(result.status, 'blocked');
  });
});

// ─── E ────────────────────────────────────────────────────────────────────────

describe('WS6 · E — página corta y reserva liquidada', () => {
  it('una página con menos filas que las pedidas cierra la rama', () => {
    assert.deepEqual(
      decidePaidPageContinuation({ rawFromPage: 12, novelUsefulFromPage: 3, requestedPageSize: 25 }),
      { continueBranch: false, stopReason: 'page_short' },
    );
    assert.deepEqual(
      decidePaidPageContinuation({ rawFromPage: 25, novelUsefulFromPage: 0, requestedPageSize: 25 }),
      { continueBranch: true },
    );
  });

  it('sin tamaño pedido, el comportamiento es el previo', () => {
    assert.deepEqual(decidePaidPageContinuation({ rawFromPage: 12, novelUsefulFromPage: 0 }), {
      continueBranch: true,
    });
  });

  const runGuard = async (reservationState: string | null | undefined) => {
    let ran = false;
    const outcome = await guardLushaRunBudget(
      async () => ({
        status: 'already_reserved',
        reservationId: 'r-1',
        creditsReserved: 2,
        ...(reservationState !== undefined ? { reservationState } : {}),
      }),
      (blocked) => ({ blocked: blocked.code }),
      async () => {
        ran = true;
        return { blocked: null as string | null };
      },
      2,
    );
    return { ran, outcome };
  };

  it('already_reserved sobre una reserva ABIERTA ejecuta', async () => {
    const { ran } = await runGuard('reserved');
    assert.equal(ran, true);
  });

  for (const state of ['confirmed', 'released', 'failed', null, undefined]) {
    it(`already_reserved con estado ${String(state)} NO ejecuta`, async () => {
      const { ran, outcome } = await runGuard(state);
      assert.equal(ran, false);
      assert.deepEqual(outcome, { blocked: LUSHA_BUDGET_RESERVATION_SETTLED_ERROR });
    });
  }
});

// ─── F (timeouts) ─────────────────────────────────────────────────────────────

describe('WS6 · F — tope de tiempo por operación', () => {
  it('vencido ⇒ rechaza con TimeoutError (cobro indeterminado aguas arriba)', async () => {
    const never = new Promise<string>(() => undefined);
    await assert.rejects(
      raceApolloOperationTimeout(never, APOLLO_OPERATION_MIN_TIMEOUT_MS),
      (err: unknown) => err instanceof Error && err.name === 'TimeoutError',
    );
  });

  it('a tiempo ⇒ devuelve el resultado', async () => {
    assert.equal(await raceApolloOperationTimeout(Promise.resolve('ok'), 5_000), 'ok');
  });
});

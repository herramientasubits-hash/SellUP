/**
 * AGENT1-COMPANY-BANK-FOUNDATION-1 — el almacén del banco (transporte).
 *
 *   § 1 · se descarta antes de enviar lo que la 142 va a rechazar;
 *   § 2 · depositar: trozos, contadores y degradación sin perder lo ya depositado;
 *   § 3 · sacar: acota, valida y NUNCA entrega una fila sin señal;
 *   § 4 · cerrar la extracción;
 *   § 5 · 🔴 nada lanza: función ausente, red o permisos ⇒ `unavailable`;
 *   § 6 · el vocabulario de TypeScript es EL de la migración 142.
 *
 * Sin red, sin base de datos, sin proveedores. 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  COMPANY_BANK_RPC_DEPOSIT,
  COMPANY_BANK_RPC_DRAW,
  COMPANY_BANK_RPC_SETTLE,
  createCompanyBankStore,
  isDepositItemWellFormed,
} from '../company-bank-store';
import {
  COMPANY_BANK_DEFAULT_TTL_DAYS,
  COMPANY_BANK_DEPOSIT_CHUNK,
  COMPANY_BANK_MAX_DRAW,
  COMPANY_BANK_MAX_PAYLOAD_BYTES,
  COMPANY_BANK_MAX_TTL_DAYS,
  COMPANY_BANK_MIN_TTL_DAYS,
  COMPANY_BANK_SETTLE_OUTCOMES,
  COMPANY_BANK_SOURCE_PROVIDERS,
  COMPANY_BANK_TIERS,
  type CompanyBankDepositItem,
} from '../company-bank-types';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const MIGRATION = readFileSync(path.join(REPO_ROOT, 'supabase/migrations/142_agent1_company_bank.sql'), 'utf8');

function item(domain: string, overrides: Partial<CompanyBankDepositItem> = {}): CompanyBankDepositItem {
  return {
    countryCode: 'CO',
    macroIndustryKey: 'technology',
    tier: 'ready',
    sourceProvider: 'lusha',
    claims: [{ type: 'domain', key: domain }],
    payload: { name: domain },
    missingFields: [],
    ...overrides,
  };
}

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(handler: (call: Call) => { data?: unknown; error?: unknown } | Promise<{ data?: unknown; error?: unknown }>) {
  const calls: Call[] = [];
  const client = {
    async rpc(fn: string, args: Record<string, unknown>) {
      const call = { fn, args };
      calls.push(call);
      const out = await handler(call);
      return { data: out.data ?? null, error: out.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

// ─── § 1 ──────────────────────────────────────────────────────────────────────

describe('§ 1 — se descarta antes de enviar lo que la 142 rechazaría', () => {
  it('una fila bien formada pasa', () => assert.equal(isDepositItemWellFormed(item('a.com')), true));

  it('🔴 cada defecto la descarta', () => {
    const bad: Array<[string, CompanyBankDepositItem]> = [
      ['país en minúscula', item('a.com', { countryCode: 'co' })],
      ['país largo', item('a.com', { countryCode: 'Colombia' })],
      ['macro con mayúsculas', item('a.com', { macroIndustryKey: 'Technology' })],
      ['tier inventado', item('a.com', { tier: 'otra' as never })],
      ['fuente inventada', item('a.com', { sourceProvider: 'x' as never })],
      ['sin señal', item('a.com', { claims: [] })],
      ['señal en blanco', item('a.com', { claims: [{ type: 'domain', key: '  ' }] })],
      ['tipo de señal inventado', item('a.com', { claims: [{ type: 'otro' as never, key: 'a' }] })],
      ['ready con faltantes', item('a.com', { tier: 'ready', missingFields: ['size'] })],
      ['to_complete sin faltantes', item('a.com', { tier: 'to_complete', missingFields: [] })],
      ['payload array', item('a.com', { payload: [] as never })],
      ['payload enorme', item('a.com', { payload: { x: 'a'.repeat(COMPANY_BANK_MAX_PAYLOAD_BYTES + 1) } })],
    ];
    for (const [name, it_] of bad) assert.equal(isDepositItemWellFormed(it_), false, name);
  });
});

// ─── § 2 ──────────────────────────────────────────────────────────────────────

describe('§ 2 — depositar', () => {
  it('envía sólo lo bien formado, en el formato de la función SQL', async () => {
    const { client, calls } = fakeClient(() => ({
      data: { status: 'ok', deposited: 1, skipped_claimed: 0, skipped_in_bank: 0, skipped_invalid: 0 },
    }));
    const store = createCompanyBankStore(client);
    const r = await store.deposit([item('a.com', { sourceBatchId: 'b1', ttlDays: 30.9 }), item('x', { countryCode: 'zz' })]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.fn, COMPANY_BANK_RPC_DEPOSIT);
    assert.deepEqual(calls[0]!.args, {
      p_items: [
        {
          countryCode: 'CO',
          macroIndustryKey: 'technology',
          tier: 'ready',
          sourceProvider: 'lusha',
          claims: [{ type: 'domain', key: 'a.com' }],
          payload: { name: 'a.com' },
          missingFields: [],
          sourceBatchId: 'b1',
          ttlDays: 30,
        },
      ],
    });
    assert.deepEqual(r, { status: 'ok', deposited: 1, skippedClaimed: 0, skippedInBank: 0, skippedInvalid: 1 });
  });

  it('nada que enviar ⇒ ok sin llamar a la base', async () => {
    const { client, calls } = fakeClient(() => ({}));
    const r = await createCompanyBankStore(client).deposit([]);
    assert.equal(calls.length, 0);
    assert.deepEqual(r, { status: 'ok', deposited: 0, skippedClaimed: 0, skippedInBank: 0, skippedInvalid: 0 });
  });

  it('🔴 parte en trozos y suma los contadores', async () => {
    const total = COMPANY_BANK_DEPOSIT_CHUNK * 2 + 3;
    const { client, calls } = fakeClient((c) => ({
      data: {
        status: 'ok',
        deposited: (c.args.p_items as unknown[]).length - 1,
        skipped_claimed: 1,
        skipped_in_bank: 0,
        skipped_invalid: 0,
      },
    }));
    const items = Array.from({ length: total }, (_, i) => item(`d${i}.com`));
    const r = await createCompanyBankStore(client).deposit(items);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((c) => (c.args.p_items as unknown[]).length), [COMPANY_BANK_DEPOSIT_CHUNK, COMPANY_BANK_DEPOSIT_CHUNK, 3]);
    assert.deepEqual(r, { status: 'ok', deposited: total - 3, skippedClaimed: 3, skippedInBank: 0, skippedInvalid: 0 });
  });

  it('🔴 si un trozo falla después de otro bueno, lo ya depositado NO se pierde', async () => {
    let n = 0;
    const { client } = fakeClient(() => {
      n += 1;
      return n === 1
        ? { data: { status: 'ok', deposited: COMPANY_BANK_DEPOSIT_CHUNK, skipped_claimed: 0, skipped_in_bank: 0, skipped_invalid: 0 } }
        : { error: { code: '57014', message: 'timeout' } };
    });
    const items = Array.from({ length: COMPANY_BANK_DEPOSIT_CHUNK + 5 }, (_, i) => item(`e${i}.com`));
    const r = await createCompanyBankStore(client).deposit(items);
    assert.equal(r.status, 'ok');
    assert.equal((r as { deposited: number }).deposited, COMPANY_BANK_DEPOSIT_CHUNK);
  });
});

// ─── § 3 ──────────────────────────────────────────────────────────────────────

function drawnRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tier: 'ready',
    source_provider: 'lusha',
    claims: [{ type: 'domain', key: 'a.com' }],
    payload: { name: 'A' },
    missing_fields: [],
    source_batch_id: null,
    banked_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

describe('§ 3 — sacar', () => {
  it('llama con los parámetros de la función SQL, acota el límite y devuelve el drawId', async () => {
    const { client, calls } = fakeClient(() => ({ data: [drawnRow()] }));
    const r = await createCompanyBankStore(client).draw({
      countryCode: 'CO',
      macroIndustryKey: 'technology',
      limit: 9999,
      drawId: '22222222-2222-4222-8222-222222222222',
    });
    assert.equal(calls[0]!.fn, COMPANY_BANK_RPC_DRAW);
    assert.deepEqual(calls[0]!.args, {
      p_country_code: 'CO',
      p_macro_industry_key: 'technology',
      p_limit: COMPANY_BANK_MAX_DRAW,
      p_draw_id: '22222222-2222-4222-8222-222222222222',
      p_reserve_seconds: 300,
      p_tiers: ['ready'],
    });
    assert.equal(r.status, 'ok');
    if (r.status === 'ok') {
      assert.equal(r.drawId, '22222222-2222-4222-8222-222222222222');
      assert.equal(r.companies.length, 1);
      assert.deepEqual(r.companies[0]!.claims, [{ type: 'domain', key: 'a.com' }]);
    }
  });

  it('límite 0, tiers vacíos o alcance inválido ⇒ no llama a la base', async () => {
    const { client, calls } = fakeClient(() => ({ data: [] }));
    const store = createCompanyBankStore(client);
    assert.equal((await store.draw({ countryCode: 'CO', macroIndustryKey: 'technology', limit: 0 })).status, 'ok');
    assert.equal((await store.draw({ countryCode: 'CO', macroIndustryKey: 'technology', limit: 3, tiers: [] })).status, 'ok');
    assert.deepEqual(await store.draw({ countryCode: 'co', macroIndustryKey: 'technology', limit: 3 }), {
      status: 'unavailable',
      reason: 'invalid_scope',
    });
    assert.equal(calls.length, 0);
  });

  it('🔴 una fila sin señal, sin payload o con vocabulario ajeno NO se entrega', async () => {
    const { client } = fakeClient(() => ({
      data: [
        drawnRow({ id: 'ok' }),
        drawnRow({ id: 'sin-claims', claims: [] }),
        drawnRow({ id: 'payload-null', payload: null }),
        drawnRow({ id: 'tier-raro', tier: 'otra' }),
        drawnRow({ id: 'fuente-rara', source_provider: 'otra' }),
      ],
    }));
    const r = await createCompanyBankStore(client).draw({ countryCode: 'CO', macroIndustryKey: 'technology', limit: 5 });
    assert.equal(r.status, 'ok');
    if (r.status === 'ok') assert.deepEqual(r.companies.map((c) => c.id), ['ok']);
  });
});

// ─── § 4 ──────────────────────────────────────────────────────────────────────

describe('§ 4 — cerrar la extracción', () => {
  it('traduce cada resultado al formato de la función SQL y lee los contadores', async () => {
    const { client, calls } = fakeClient(() => ({
      data: { status: 'ok', assigned: 1, invalidated: 1, released: 1, ignored: 0 },
    }));
    const r = await createCompanyBankStore(client).settle('d1', [
      { id: 'a', outcome: 'assigned', batchId: 'b', candidateId: 'c' },
      { id: 'b', outcome: 'invalidated', reason: 'claimed_elsewhere' },
      { id: 'c', outcome: 'released' },
      { id: 'd', outcome: 'otro' as never },
    ]);
    assert.equal(calls[0]!.fn, COMPANY_BANK_RPC_SETTLE);
    assert.deepEqual(calls[0]!.args, {
      p_draw_id: 'd1',
      p_outcomes: [
        { id: 'a', outcome: 'assigned', batchId: 'b', candidateId: 'c' },
        { id: 'b', outcome: 'invalidated', reason: 'claimed_elsewhere' },
        { id: 'c', outcome: 'released' },
      ],
    });
    assert.deepEqual(r, { status: 'ok', assigned: 1, invalidated: 1, released: 1, ignored: 0 });
  });

  it('sin resultados válidos ⇒ ok sin llamar', async () => {
    const { client, calls } = fakeClient(() => ({}));
    const r = await createCompanyBankStore(client).settle('d1', []);
    assert.equal(calls.length, 0);
    assert.equal(r.status, 'ok');
  });
});

// ─── § 5 ──────────────────────────────────────────────────────────────────────

describe('§ 5 — 🔴 nada lanza', () => {
  const failing = [
    ['función ausente (migración sin aplicar)', () => ({ error: { code: 'PGRST202', message: 'Could not find the function' } })],
    ['permiso denegado', () => ({ error: { code: '42501', message: 'permission denied' } })],
    ['rpc que lanza', () => { throw new Error('network down'); }],
  ] as const;

  for (const [name, handler] of failing) {
    it(`${name} ⇒ unavailable en las tres operaciones`, async () => {
      const { client } = fakeClient(handler as never);
      const store = createCompanyBankStore(client);
      const dep = await store.deposit([item('a.com')]);
      const drw = await store.draw({ countryCode: 'CO', macroIndustryKey: 'technology', limit: 3 });
      const stl = await store.settle('d1', [{ id: 'a', outcome: 'released' }]);
      for (const r of [dep, drw, stl]) {
        assert.equal(r.status, 'unavailable');
        assert.ok((r as { reason: string }).reason.length > 0);
      }
    });
  }

  it('una respuesta con estado raro también es unavailable', async () => {
    const { client } = fakeClient(() => ({ data: { status: 'invalid_input' } }));
    const store = createCompanyBankStore(client);
    assert.equal((await store.deposit([item('a.com')])).status, 'unavailable');
    assert.equal((await store.settle('d1', [{ id: 'a', outcome: 'released' }])).status, 'unavailable');
  });
});

// ─── § 6 ──────────────────────────────────────────────────────────────────────

describe('§ 6 — el vocabulario de TypeScript es EL de la migración 142', () => {
  const sqlList = (constraint: string): string[] => {
    const m = MIGRATION.match(new RegExp(`${constraint}\\s+CHECK \\(\\w+ IN \\(([^)]*)\\)\\)`));
    assert.ok(m, `no encuentro ${constraint} en la 142`);
    return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
  };

  it('tiers, fuentes y estados', () => {
    assert.deepEqual(sqlList('agent1_company_bank_tier_check'), [...COMPANY_BANK_TIERS]);
    assert.deepEqual(sqlList('agent1_company_bank_source_provider_check'), [...COMPANY_BANK_SOURCE_PROVIDERS]);
  });

  it('los resultados de cerrar una extracción existen en la función SQL', () => {
    for (const outcome of COMPANY_BANK_SETTLE_OUTCOMES) {
      assert.match(MIGRATION, new RegExp(`v_outcome = '${outcome}'`), outcome);
    }
  });

  it('los topes de TypeScript no superan los de la base', () => {
    assert.match(MIGRATION, /GREATEST\(COALESCE\(\(v_item->>'ttlDays'\)::int, 60\), 1\), 180/);
    assert.equal(COMPANY_BANK_DEFAULT_TTL_DAYS, 60);
    assert.equal(COMPANY_BANK_MIN_TTL_DAYS, 1);
    assert.equal(COMPANY_BANK_MAX_TTL_DAYS, 180);
    assert.match(MIGRATION, /LEAST\(GREATEST\(COALESCE\(p_limit, 0\), 0\), 50\)/);
    assert.equal(COMPANY_BANK_MAX_DRAW, 50);
    assert.match(MIGRATION, /pg_column_size\(payload\) <= 16384/);
    assert.equal(COMPANY_BANK_MAX_PAYLOAD_BYTES, 16384);
  });

  it('los nombres de las funciones y de sus parámetros son los de la 142', () => {
    for (const fn of [COMPANY_BANK_RPC_DEPOSIT, COMPANY_BANK_RPC_DRAW, COMPANY_BANK_RPC_SETTLE]) {
      assert.match(MIGRATION, new RegExp(`FUNCTION public\\.${fn}\\(`), fn);
    }
    for (const p of ['p_items', 'p_country_code', 'p_macro_industry_key', 'p_limit', 'p_draw_id', 'p_reserve_seconds', 'p_tiers', 'p_outcomes']) {
      assert.match(MIGRATION, new RegExp(`\\b${p}\\b`), p);
    }
  });
});

// ─── seguridad estática ───────────────────────────────────────────────────────

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('seguridad estática del almacén', () => {
  const code = stripComments(
    readFileSync(path.join(REPO_ROOT, 'src/server/prospect-batches/company-bank/company-bank-store.ts'), 'utf8'),
  );

  it('no llama a ningún proveedor ni lee flags/entorno', () => {
    assert.doesNotMatch(code, /\bfetch\s*\(/);
    assert.doesNotMatch(code, /process\.env/);
    assert.doesNotMatch(code, /feature-flags/);
    for (const forbidden of ['apollo', 'lusha-client', 'tavily', 'hubspot', 'anthropic']) {
      assert.ok(!new RegExp(`from '[^']*${forbidden}[^']*'`, 'i').test(code), forbidden);
    }
  });

  it('no crea su propio cliente: se inyecta', () => {
    assert.doesNotMatch(code, /createClient\(/);
    assert.doesNotMatch(code, /createSupabaseAdminClient/);
  });
});

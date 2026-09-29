/**
 * AGENT1-APOLLO-SEEN-DOMAIN-EXCLUSION-SCOPE-1 — qué se le pide a Apollo que NO
 * devuelva, corregido antes de encender la bandera.
 *
 * La auditoría del 2026-09-29 encontró tres defectos en la exclusión (#462):
 *
 *   § 1 · no conocía los candidatos VIVOS de SellUp (sólo `accounts`), aunque su
 *         cabecera decía lo contrario: se pagaba por ver empresas ya propuestas;
 *   § 2 · ocultaba 30 días, a TODOS los vendedores, empresas que un vendedor
 *         DESCARTÓ — el descarte libera la empresa («una empresa, un vendedor»);
 *   § 3 · un fallo de lectura de la memoria se publicaba como «memoria vacía»
 *         (`readOutcome: 'succeeded'`).
 *
 *   § 4 · el lector de SellUp: consultas, `www.`, y degradación sin ampliar;
 *   § 5 · el asistente sólo consulta con la bandera encendida.
 *
 * Sin red, sin base de datos, sin Apollo. 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveApolloSeenDomainExclusion } from '@/modules/prospect-batches/provider-seen/apollo-seen-domain-exclusion';
import type { ProviderSeenMemory } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { loadApolloExclusionSellupDomains } from '../apollo-exclusion-sellup-domains.server';
import { createSupabaseProviderSeenStore } from '../provider-seen-supabase-store';
import { runPrePaidNoveltyGate } from '../../country-source-discovery/run-prepaid-novelty-gate';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const NOW = new Date('2026-09-29T20:00:00.000Z');
const RECENT = '2026-09-25T10:00:00.000Z';

function memory(domains: string[]): ProviderSeenMemory {
  return {
    providerEntityIds: new Set(),
    normalizedDomains: new Set(domains),
    domainLastSeenAt: new Map(domains.map((d) => [d, RECENT])),
  };
}

// ─── §§ 1, 2 ──────────────────────────────────────────────────────────────────

describe('§ 1 — los candidatos vivos de SellUp se excluyen como lo nuestro', () => {
  it('🔴 un candidato vivo se excluye aunque no sea cuenta ni se haya visto', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: ['cuenta.com.pe'],
      providerSeenMemory: null,
      sellupLiveDomains: ['propuesta.com.pe'],
      now: NOW,
    });
    assert.deepEqual(r.domains, ['cuenta.com.pe', 'propuesta.com.pe']);
    assert.equal(r.telemetry.from_authority, 2);
    assert.equal(r.telemetry.from_sellup_live, 1);
  });

  it('una cuenta que además es candidato cuenta una vez, como cuenta', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: ['ambas.com'],
      providerSeenMemory: null,
      sellupLiveDomains: ['AMBAS.com'],
      now: NOW,
    });
    assert.deepEqual(r.domains, ['ambas.com']);
    assert.equal(r.telemetry.from_sellup_live, 0);
  });

  it('con tope, lo nuestro (cuentas + vivos) va antes que lo visto', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: ['a.com'],
      providerSeenMemory: memory(['visto.com']),
      sellupLiveDomains: ['b.com'],
      now: NOW,
      cap: 2,
    });
    assert.deepEqual(r.domains, ['a.com', 'b.com']);
    assert.equal(r.telemetry.omitted_due_to_cap, 1);
  });
});

describe('§ 2 — lo descartado vuelve a estar disponible para los demás', () => {
  it('🔴 un visto que en SellUp sólo está descartado NO se excluye', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: [],
      providerSeenMemory: memory(['descartada.com', 'vista.com']),
      releasedDomains: ['descartada.com'],
      now: NOW,
    });
    assert.deepEqual(r.domains, ['vista.com']);
    assert.equal(r.telemetry.seen_released_by_discard, 1);
  });

  it('si otro vendedor la tiene viva, sigue excluida (lo vivo manda)', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: [],
      providerSeenMemory: memory(['disputada.com']),
      sellupLiveDomains: ['disputada.com'],
      releasedDomains: ['disputada.com'],
      now: NOW,
    });
    assert.deepEqual(r.domains, ['disputada.com']);
  });

  it('apagada, no excluye nada aunque haya vivos y descartados', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: false,
      authorityDomains: ['a.com'],
      providerSeenMemory: memory(['b.com']),
      sellupLiveDomains: ['c.com'],
      releasedDomains: ['b.com'],
      now: NOW,
    });
    assert.deepEqual(r.domains, []);
    assert.equal(r.telemetry.from_sellup_live, 0);
    assert.equal(r.telemetry.seen_released_by_discard, 0);
  });
});

// ─── § 3 ──────────────────────────────────────────────────────────────────────

function failingStoreClient(): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: async () => ({ data: null, error: { message: 'boom' } }),
  };
  return { from: () => builder, rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;
}

describe('§ 3 — un fallo de lectura se publica como fallo, no como memoria vacía', () => {
  it('🔴 con el store real y una lectura rota, el gate publica readOutcome ≠ succeeded', async () => {
    const result = await runPrePaidNoveltyGate(
      { provider: 'apollo', countryCode: 'PE', macroIndustryKey: 'health_pharma', requestedTarget: 5 },
      { providerSeenStore: createSupabaseProviderSeenStore(failingStoreClient()) },
    );
    assert.notEqual(result.providerSeen.readOutcome, 'succeeded');
    assert.equal(result.providerSeen.loaded, false);
    // Y sigue siendo fail-open: la corrida no se cae y pide el objetivo entero.
    assert.equal(result.context.residualGap, 5);
  });
});

// ─── § 4 ──────────────────────────────────────────────────────────────────────

type Call = { table: string; select: string; eq: Array<[string, unknown]>; not: Array<[string, string, unknown]>; in: unknown[] | null };

function sellupClient(opts: {
  live?: Array<{ domain: string | null }>;
  byDomain?: Array<{ domain: string; status: string }>;
  liveError?: boolean;
  inError?: boolean;
}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, select: '', eq: [], not: [], in: null };
      calls.push(call);
      const builder = {
        select(cols: string) { call.select = cols; return builder; },
        eq(c: string, v: unknown) { call.eq.push([c, v]); return builder; },
        not(c: string, op: string, v: unknown) { call.not.push([c, op, v]); return builder; },
        order() { return builder; },
        async limit() {
          return opts.liveError ? { data: null, error: { message: 'x' } } : { data: opts.live ?? [], error: null };
        },
        async in(_c: string, values: unknown[]) {
          call.in = values;
          if (opts.inError) return { data: null, error: { message: 'x' } };
          const wanted = new Set(values as string[]);
          return { data: (opts.byDomain ?? []).filter((r) => wanted.has(r.domain)), error: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('§ 4 — el lector de SellUp', () => {
  it('vivos: del país, sin descartados ni duplicados, normalizados', async () => {
    const { client, calls } = sellupClient({ live: [{ domain: 'https://www.Viva.com.pe/' }, { domain: null }] });
    const r = await loadApolloExclusionSellupDomains(client, { countryCode: 'PE', seenDomains: [] });
    assert.deepEqual(r.liveDomains, ['viva.com.pe']);
    assert.deepEqual(calls[0]!.eq, [['country_code', 'PE']]);
    assert.ok(calls[0]!.not.some(([c, op, v]) => c === 'status' && op === 'in' && v === '(discarded,duplicate)'));
  });

  it('🔴 liberados: sólo descartados, y la columna con `www.` también cuenta', async () => {
    const { client } = sellupClient({
      byDomain: [
        { domain: 'www.solo-descartada.com', status: 'discarded' },
        { domain: 'descartada-y-viva.com', status: 'discarded' },
        { domain: 'descartada-y-viva.com', status: 'needs_review' },
        { domain: 'viva.com', status: 'needs_review' },
      ],
    });
    const r = await loadApolloExclusionSellupDomains(client, {
      countryCode: 'PE',
      seenDomains: ['solo-descartada.com', 'descartada-y-viva.com', 'viva.com', 'nunca-guardada.com'],
    });
    assert.deepEqual(r.releasedDomains, ['solo-descartada.com']);
    assert.equal(r.degraded, false);
  });

  it('una lectura rota degrada SIN ampliar la exclusión ni liberar nada', async () => {
    const { client } = sellupClient({ liveError: true, inError: true });
    const r = await loadApolloExclusionSellupDomains(client, { countryCode: 'PE', seenDomains: ['a.com'] });
    assert.deepEqual(r, { liveDomains: [], releasedDomains: [], degraded: true });
  });
});

// ─── § 5 ──────────────────────────────────────────────────────────────────────

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('§ 5 — el asistente sólo consulta con la bandera encendida', () => {
  it('la llamada al lector se condiciona a la bandera y usa el cliente administrativo', () => {
    const wizard = stripComments(
      readFileSync(
        path.join(REPO_ROOT, 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts'),
        'utf8',
      ),
    );
    assert.match(wizard, /apolloSeenDomainExclusionEnabled\s*&&\s*deps\.loadApolloExclusionSellupDomains/);
    assert.match(wizard, /loadApolloExclusionSellupDomains\(createSupabaseAdminClient\(\), input\)/);
    assert.match(wizard, /sellupLiveDomains:\s*apolloExclusionSellup\?\.liveDomains \?\? \[\]/);
    assert.match(wizard, /releasedDomains:\s*apolloExclusionSellup\?\.releasedDomains \?\? \[\]/);
  });
});

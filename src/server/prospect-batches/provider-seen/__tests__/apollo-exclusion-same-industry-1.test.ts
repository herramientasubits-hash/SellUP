/**
 * AGENT1-APOLLO-EXCLUSION-SAME-INDUSTRY-1 — la lista de exclusión de Apollo se
 * acota al país y la industria de la corrida.
 *
 * Medido en Producción el 2026-09-30 (Colombia × Tecnología, lote `b89e28ec`): la
 * lista salió con 500 dominios y 205 más quedaron fuera por el tope. Apollo ha
 * mostrado 721 empresas, pero sólo 133 eran de Colombia × Tecnología: el resto,
 * de México, Perú, Colombia-Gobierno y Colombia-Retail, ocupaba sitio. Las que sí
 * importaban se caían por el tope y volvían como repetidas.
 *
 *   § 1 · qué lote cuenta como «otra corrida» (prueba positiva, nunca por defecto);
 *   § 2 · un dominio sobra sólo si TODO lo que se sabe de él está fuera;
 *   § 3 · el lector de candidatos vivos descarta los de otra industria;
 *   § 4 · el lector de vistos descarta los de otro país u otra industria;
 *   § 5 · el plan de exclusión los cuenta y no los envía;
 *   § 6 · el caso medido: con alcance el tope deja de morder;
 *   § 7 · el asistente pasa la macro y sin ella todo sigue igual.
 *
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveApolloSeenDomainExclusion } from '@/modules/prospect-batches/provider-seen/apollo-seen-domain-exclusion';
import type { ProviderSeenMemory } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import {
  classifyBatchScope,
  isBatchCorrelationId,
  isSeenDomainOutOfScope,
} from '../apollo-exclusion-scope';
import { loadApolloExclusionSellupDomains } from '../apollo-exclusion-sellup-domains.server';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const NOW = new Date('2026-09-30T22:00:00.000Z');
const RECENT = '2026-09-25T10:00:00.000Z';
const RUN = { countryCode: 'CO', macroIndustryKey: 'technology' };
const TECH_SCOPE = { industrySlug: 'technology', industryName: 'Tecnología' };

const B_CO_TECH = '11111111-1111-4111-8111-111111111111';
const B_CO_TECH_2 = '11111111-1111-4111-8111-222222222222';
const B_CO_GOV = '22222222-2222-4222-8222-222222222222';
const B_MX_TECH = '33333333-3333-4333-8333-333333333333';
const B_IMPORT = '44444444-4444-4444-8444-444444444444';
const B_MISSING = '55555555-5555-4555-8555-555555555555';

const BATCHES = [
  { id: B_CO_TECH, country_code: 'CO', industry: 'Tecnología' },
  { id: B_CO_TECH_2, country_code: 'CO', industry: 'technology' },
  { id: B_CO_GOV, country_code: 'CO', industry: 'Gobierno' },
  { id: B_MX_TECH, country_code: 'MX', industry: 'Tecnología' },
  { id: B_IMPORT, country_code: 'CO', industry: 'Clasificación interna rara' },
];

// ─── § 1 ──────────────────────────────────────────────────────────────────────

describe('§ 1 — qué lote es de otra corrida', () => {
  it('mismo país y misma industria ⇒ in_scope (por nombre o por slug)', () => {
    assert.equal(classifyBatchScope({ country_code: 'CO', industry: 'Tecnología' }, RUN), 'in_scope');
    assert.equal(classifyBatchScope({ country_code: 'co', industry: 'technology' }, RUN), 'in_scope');
  });

  it('🔴 otra industria reconocida ⇒ out_of_scope', () => {
    assert.equal(classifyBatchScope({ country_code: 'CO', industry: 'Gobierno' }, RUN), 'out_of_scope');
  });

  it('🔴 otro país conocido ⇒ out_of_scope, aunque la industria coincida', () => {
    assert.equal(classifyBatchScope({ country_code: 'MX', industry: 'Tecnología' }, RUN), 'out_of_scope');
  });

  it('🔴 sin prueba positiva ⇒ unknown, nunca out_of_scope', () => {
    assert.equal(classifyBatchScope({ country_code: 'CO', industry: 'Clasificación interna rara' }, RUN), 'unknown');
    assert.equal(classifyBatchScope({ country_code: 'CO', industry: null }, RUN), 'unknown');
    assert.equal(classifyBatchScope({ country_code: null, industry: 'Tecnología' }, RUN), 'unknown');
  });

  it('con countryCode null no se compara el país (los vivos ya se leyeron por país)', () => {
    const run = { countryCode: null, macroIndustryKey: 'technology' };
    assert.equal(classifyBatchScope({ country_code: 'MX', industry: 'Tecnología' }, run), 'in_scope');
    assert.equal(classifyBatchScope({ country_code: 'MX', industry: 'Gobierno' }, run), 'out_of_scope');
  });

  it('la correlación de Apollo es un id de lote; lo demás no se lee como lote', () => {
    assert.equal(isBatchCorrelationId(B_CO_TECH), true);
    assert.equal(isBatchCorrelationId('0d98304bc325d8081e7905b78f3f056f'), false);
    assert.equal(isBatchCorrelationId(null), false);
  });
});

// ─── § 2 ──────────────────────────────────────────────────────────────────────

describe('§ 2 — un dominio sobra sólo si TODO lo que se sabe de él está fuera', () => {
  const scope = new Map<string, 'in_scope' | 'out_of_scope' | 'unknown'>([
    [B_CO_TECH, 'in_scope'],
    [B_CO_GOV, 'out_of_scope'],
    [B_MX_TECH, 'out_of_scope'],
    [B_IMPORT, 'unknown'],
  ]);

  it('todos los lotes fuera ⇒ sobra', () => {
    assert.equal(isSeenDomainOutOfScope([B_CO_GOV, B_MX_TECH], scope), true);
  });
  it('🔴 visto también en la corrida ⇒ se queda', () => {
    assert.equal(isSeenDomainOutOfScope([B_CO_GOV, B_CO_TECH], scope), false);
  });
  it('🔴 un lote desconocido o no encontrado ⇒ se queda', () => {
    assert.equal(isSeenDomainOutOfScope([B_CO_GOV, B_IMPORT], scope), false);
    assert.equal(isSeenDomainOutOfScope([B_CO_GOV, B_MISSING], scope), false);
  });
  it('sin ninguna correlación ⇒ se queda', () => {
    assert.equal(isSeenDomainOutOfScope([], scope), false);
  });
});

// ─── cliente falso ────────────────────────────────────────────────────────────

type SeenRow = {
  normalized_domain: string;
  first_seen_correlation: string | null;
  last_seen_correlation: string | null;
};

function fakeClient(opts: {
  live?: Array<{ domain: string | null; batch_id: string | null }>;
  batches?: typeof BATCHES;
  seen?: SeenRow[];
  batchesError?: boolean;
  seenError?: boolean;
}) {
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      let selected = '';
      const builder = {
        select(cols: string) { selected = cols; return builder; },
        eq() { return builder; },
        not() { return builder; },
        order() { return builder; },
        async limit() { return { data: opts.live ?? [], error: null }; },
        async in(_c: string, values: unknown[]) {
          const wanted = new Set(values as string[]);
          if (table === 'prospect_batches') {
            if (opts.batchesError) return { data: null, error: { message: 'x' } };
            return { data: (opts.batches ?? BATCHES).filter((b) => wanted.has(b.id)), error: null };
          }
          if (table === 'provider_seen_entities') {
            if (opts.seenError) return { data: null, error: { message: 'x' } };
            return { data: (opts.seen ?? []).filter((r) => wanted.has(r.normalized_domain)), error: null };
          }
          // `prospect_candidates` por dominio (liberados): nada.
          void selected;
          return { data: [], error: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, tables };
}

// ─── § 3 ──────────────────────────────────────────────────────────────────────

describe('§ 3 — candidatos vivos: los de otra industria no ocupan sitio', () => {
  const live = [
    { domain: 'tech.com.co', batch_id: B_CO_TECH },
    { domain: 'tech2.com.co', batch_id: B_CO_TECH_2 },
    { domain: 'gobierno.gov.co', batch_id: B_CO_GOV },
    { domain: 'importada.com.co', batch_id: B_IMPORT },
    { domain: 'sinlote.com.co', batch_id: null },
  ];

  it('🔴 excluye los de su industria y los de alcance desconocido; deja fuera los de otra', async () => {
    const { client } = fakeClient({ live });
    const r = await loadApolloExclusionSellupDomains(client, {
      countryCode: 'CO',
      seenDomains: [],
      scope: TECH_SCOPE,
    });
    assert.deepEqual([...r.liveDomains].sort(), ['importada.com.co', 'sinlote.com.co', 'tech.com.co', 'tech2.com.co']);
    assert.equal(r.liveOutOfScopeCount, 1);
    assert.equal(r.degraded, false);
  });

  it('🔴 si el alcance de los lotes no se puede leer, NADIE se descarta (degrada sin ampliar)', async () => {
    const { client } = fakeClient({ live, batchesError: true });
    const r = await loadApolloExclusionSellupDomains(client, {
      countryCode: 'CO',
      seenDomains: [],
      scope: TECH_SCOPE,
    });
    assert.ok(r.liveDomains.includes('gobierno.gov.co'));
    assert.equal(r.liveOutOfScopeCount, 0);
    assert.equal(r.degraded, true);
  });

  it('sin alcance, el lector es el de siempre (todas las industrias, sin campos nuevos)', async () => {
    const { client, tables } = fakeClient({ live });
    const r = await loadApolloExclusionSellupDomains(client, { countryCode: 'CO', seenDomains: [] });
    assert.equal(r.outOfScopeSeenDomains, undefined);
    assert.equal(r.liveOutOfScopeCount, undefined);
    assert.ok(!tables.includes('prospect_batches'));
    assert.ok(r.liveDomains.includes('gobierno.gov.co'));
  });
});

// ─── § 4 ──────────────────────────────────────────────────────────────────────

describe('§ 4 — vistos: los de otro país u otra industria no ocupan sitio', () => {
  const seen: SeenRow[] = [
    { normalized_domain: 'mexicana.com.mx', first_seen_correlation: B_MX_TECH, last_seen_correlation: B_MX_TECH },
    { normalized_domain: 'solo-gobierno.gov.co', first_seen_correlation: B_CO_GOV, last_seen_correlation: B_CO_GOV },
    { normalized_domain: 'de-la-corrida.com.co', first_seen_correlation: B_CO_TECH, last_seen_correlation: B_CO_TECH },
    { normalized_domain: 'primero-gobierno-luego-tech.com.co', first_seen_correlation: B_CO_GOV, last_seen_correlation: B_CO_TECH },
    { normalized_domain: 'sin-correlacion.com', first_seen_correlation: null, last_seen_correlation: null },
    { normalized_domain: 'nula-y-gobierno.com', first_seen_correlation: null, last_seen_correlation: B_CO_GOV },
    { normalized_domain: 'correlacion-rara.com', first_seen_correlation: 'abc123', last_seen_correlation: 'abc123' },
    { normalized_domain: 'lote-perdido.com', first_seen_correlation: B_MISSING, last_seen_correlation: B_MISSING },
    { normalized_domain: 'de-importacion.com.co', first_seen_correlation: B_IMPORT, last_seen_correlation: B_IMPORT },
    { normalized_domain: 'mx-luego-gobierno.com', first_seen_correlation: B_MX_TECH, last_seen_correlation: B_CO_GOV },
  ];
  const seenDomains = seen.map((r) => r.normalized_domain);

  it('🔴 sólo sobran los que TODA su historia sitúa fuera de Colombia × Tecnología', async () => {
    const { client } = fakeClient({ seen });
    const r = await loadApolloExclusionSellupDomains(client, {
      countryCode: 'CO',
      seenDomains,
      scope: TECH_SCOPE,
    });
    assert.deepEqual(r.outOfScopeSeenDomains, [
      'mexicana.com.mx',
      'mx-luego-gobierno.com',
      'solo-gobierno.gov.co',
    ]);
  });

  it('🔴 lo que está vivo en la corrida nunca se declara fuera', async () => {
    const { client } = fakeClient({ seen, live: [{ domain: 'solo-gobierno.gov.co', batch_id: B_CO_TECH }] });
    const r = await loadApolloExclusionSellupDomains(client, {
      countryCode: 'CO',
      seenDomains,
      scope: TECH_SCOPE,
    });
    assert.ok(!r.outOfScopeSeenDomains!.includes('solo-gobierno.gov.co'));
  });

  it('🔴 una lectura rota deja TODOS los vistos en la lista y lo declara', async () => {
    for (const broken of [{ seenError: true }, { batchesError: true }]) {
      const { client } = fakeClient({ seen, ...broken });
      const r = await loadApolloExclusionSellupDomains(client, {
        countryCode: 'CO',
        seenDomains,
        scope: TECH_SCOPE,
      });
      assert.deepEqual(r.outOfScopeSeenDomains, [], JSON.stringify(broken));
      assert.equal(r.degraded, true, JSON.stringify(broken));
    }
  });
});

// ─── § 5 ──────────────────────────────────────────────────────────────────────

function memory(domains: string[]): ProviderSeenMemory {
  return {
    providerEntityIds: new Set(),
    normalizedDomains: new Set(domains),
    domainLastSeenAt: new Map(domains.map((d) => [d, RECENT])),
  };
}

describe('§ 5 — el plan no envía lo que sobra y lo cuenta', () => {
  it('🔴 un visto fuera de alcance no se envía y queda en la telemetría', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: ['cuenta.com.co'],
      providerSeenMemory: memory(['mexicana.com.mx', 'de-la-corrida.com.co']),
      outOfScopeSeenDomains: ['mexicana.com.mx'],
      liveOutOfScopeCount: 7,
      now: NOW,
    });
    assert.deepEqual(r.domains, ['cuenta.com.co', 'de-la-corrida.com.co']);
    assert.equal(r.telemetry.seen_out_of_scope, 1);
    assert.equal(r.telemetry.live_out_of_scope, 7);
    assert.equal(r.telemetry.from_recent_seen, 1);
  });

  it('una cuenta o un vivo nunca se descarta por alcance', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: ['cuenta.com.co'],
      providerSeenMemory: memory(['cuenta.com.co']),
      outOfScopeSeenDomains: ['cuenta.com.co'],
      now: NOW,
    });
    assert.deepEqual(r.domains, ['cuenta.com.co']);
  });

  it('sin la entrada nueva, el plan es el de antes y la telemetría dice 0', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: [],
      providerSeenMemory: memory(['a.com']),
      now: NOW,
    });
    assert.deepEqual(r.domains, ['a.com']);
    assert.equal(r.telemetry.seen_out_of_scope, 0);
    assert.equal(r.telemetry.live_out_of_scope, 0);
  });

  it('apagada, todo a 0', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: false,
      authorityDomains: ['a.com'],
      providerSeenMemory: memory(['b.com']),
      outOfScopeSeenDomains: ['b.com'],
      liveOutOfScopeCount: 3,
      now: NOW,
    });
    assert.deepEqual(r.domains, []);
    assert.equal(r.telemetry.seen_out_of_scope, 0);
    assert.equal(r.telemetry.live_out_of_scope, 0);
  });
});

// ─── § 6 ──────────────────────────────────────────────────────────────────────

describe('§ 6 — el caso medido: con alcance el tope deja de morder', () => {
  // Lote b89e28ec: 318 de lo nuestro + 387 vistos recientes = 705 candidatos a la
  // lista; tope 500 ⇒ 205 fuera. De los 387 vistos, 133 eran de Colombia ×
  // Tecnología (aquí 117 tras quitar los que ya eran vivos): el resto, de otras
  // corridas.
  const authority = Array.from({ length: 318 }, (_, i) => `nuestra${i}.com.co`);
  const inScope = Array.from({ length: 117 }, (_, i) => `co-tech${i}.com.co`);
  const outOfScope = Array.from({ length: 270 }, (_, i) => `otra-corrida${i}.com`);

  it('🔴 sin alcance: 500 enviados y 205 fuera (lo medido)', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: authority,
      providerSeenMemory: memory([...inScope, ...outOfScope]),
      now: NOW,
    });
    assert.equal(r.telemetry.sent, 500);
    assert.equal(r.telemetry.omitted_due_to_cap, 205);
  });

  it('🔴 con alcance: entran TODAS las de Colombia × Tecnología y nada queda fuera', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: authority,
      providerSeenMemory: memory([...inScope, ...outOfScope]),
      outOfScopeSeenDomains: outOfScope,
      now: NOW,
    });
    assert.equal(r.telemetry.omitted_due_to_cap, 0);
    assert.equal(r.telemetry.sent, 318 + 117);
    for (const d of inScope) assert.ok(r.domains.includes(d), d);
    for (const d of outOfScope) assert.ok(!r.domains.includes(d), d);
  });
});

// ─── § 7 ──────────────────────────────────────────────────────────────────────

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('§ 7 — el asistente pasa la industria de la corrida', () => {
  const wizard = stripComments(
    readFileSync(
      path.join(REPO_ROOT, 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts'),
      'utf8',
    ),
  );

  it('la industria publicada llega al lector, que la resuelve con la autoridad macro', () => {
    assert.match(
      wizard,
      /scope:\s*\{\s*industrySlug: catalogResolution\.industry\.slug,\s*industryName: catalogResolution\.industry\.name,\s*\}/,
    );
    // El asistente NO abre un call-site más de la autoridad (su guarda exige tres).
    assert.doesNotMatch(wizard, /apolloExclusionMacroIndustryKey/);
  });

  it('🔴 lo que el lector descarta llega al plan', () => {
    assert.match(wizard, /outOfScopeSeenDomains:\s*apolloExclusionSellup\?\.outOfScopeSeenDomains \?\? \[\]/);
    assert.match(wizard, /liveOutOfScopeCount:\s*apolloExclusionSellup\?\.liveOutOfScopeCount \?\? 0/);
  });
});

describe('§ 8 — una industria sin macro conocida no acota nada', () => {
  it('🔴 slug y nombre que no resuelven ⇒ el lector es el de siempre (todas las industrias)', async () => {
    const { client, tables } = fakeClient({
      live: [
        { domain: 'tech.com.co', batch_id: B_CO_TECH },
        { domain: 'gobierno.gov.co', batch_id: B_CO_GOV },
      ],
    });
    const r = await loadApolloExclusionSellupDomains(client, {
      countryCode: 'CO',
      seenDomains: [],
      scope: { industrySlug: 'no-existe', industryName: 'Industria inventada' },
    });
    assert.deepEqual([...r.liveDomains].sort(), ['gobierno.gov.co', 'tech.com.co']);
    assert.equal(r.outOfScopeSeenDomains, undefined);
    assert.equal(r.liveOutOfScopeCount, undefined);
    assert.ok(!tables.includes('prospect_batches'));
  });
});

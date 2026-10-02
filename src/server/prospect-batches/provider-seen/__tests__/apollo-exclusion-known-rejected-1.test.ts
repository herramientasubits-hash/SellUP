/**
 * AGENT1-APOLLO-EXCLUSION-KNOWN-REJECTED-1 — lo que SellUp YA ENTREGÓ y los
 * filtros gratuitos de Apollo rechazarían siempre se excluye al FINAL de la lista.
 *
 * Medido en Producción el 2026-10-02 (Colombia × Industria, lote `74c06a71`):
 * Apollo devolvió 59 empresas y 18 se rechazaron gratis por «sugerida hace poco»
 * (enfriamiento global de 30 días + memoria de entrega permanente). Eran
 * descartes que la exclusión «liberaba» y vivos de otra industria que la
 * exclusión por industria dejaba fuera: Apollo los devolvía ocupando sitio en la
 * página. Ahora van al final de la lista (nunca desplazan a lo nuestro ni a lo
 * visto); lo que el tope de entrega dejó fuera sigue liberado.
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
import { loadApolloExclusionSellupDomains } from '../apollo-exclusion-sellup-domains.server';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const NOW = new Date('2026-10-02T13:00:00.000Z');
const RECENT = '2026-09-30T10:00:00.000Z';
const TECH_SCOPE = { industrySlug: 'technology', industryName: 'Tecnología' };

const B_CO_TECH = '11111111-1111-4111-8111-111111111111';
const B_CO_TECH_2 = '11111111-1111-4111-8111-222222222222';
const B_CO_GOV = '22222222-2222-4222-8222-222222222222';
const B_MX_TECH = '33333333-3333-4333-8333-333333333333';
const B_IMPORT = '44444444-4444-4444-8444-444444444444';

const BATCHES = [
  { id: B_CO_TECH, country_code: 'CO', industry: 'Tecnología' },
  { id: B_CO_TECH_2, country_code: 'CO', industry: 'technology' },
  { id: B_CO_GOV, country_code: 'CO', industry: 'Gobierno' },
  { id: B_MX_TECH, country_code: 'MX', industry: 'Tecnología' },
  { id: B_IMPORT, country_code: 'CO', industry: 'Clasificación interna rara' },
];

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


function memory(domains: string[]): ProviderSeenMemory {
  return {
    normalizedDomains: new Set(domains),
    domainLastSeenAt: new Map(domains.map((d) => [d, RECENT])),
  } as unknown as ProviderSeenMemory;
}

describe('lector — vivos de otra industria = ya entregados', () => {
  it('🔴 no entran como «nuestros» pero sí como ya entregados (al final)', async () => {
    const { client } = fakeClient({
      live: [
        { domain: 'tech.com.co', batch_id: B_CO_TECH },
        { domain: 'gobierno.gov.co', batch_id: B_CO_GOV },
      ],
    });
    const r = await loadApolloExclusionSellupDomains(client, {
      countryCode: 'CO',
      seenDomains: [],
      scope: TECH_SCOPE,
    });
    assert.deepEqual(r.liveDomains, ['tech.com.co']);
    assert.equal(r.liveOutOfScopeCount, 1);
    assert.deepEqual(r.knownRejectedDomains, ['gobierno.gov.co']);
  });

  it('sin nada ya entregado, el campo no aparece (resultado idéntico al de antes)', async () => {
    const { client } = fakeClient({ live: [{ domain: 'tech.com.co', batch_id: B_CO_TECH }] });
    const r = await loadApolloExclusionSellupDomains(client, { countryCode: 'CO', seenDomains: [], scope: TECH_SCOPE });
    assert.equal(r.knownRejectedDomains, undefined);
  });
});

describe('plan — los ya entregados van al FINAL y nunca desplazan', () => {
  const base = {
    enabled: true,
    authorityDomains: ['cuenta.co'],
    providerSeenMemory: memory(['visto.co', 'descartado.co']),
    sellupLiveDomains: ['vivo.co'],
    now: NOW,
  };

  it('🔴 orden: nuestro → visto → ya entregado; sin repetir lo que ya está delante', () => {
    const r = resolveApolloSeenDomainExclusion({
      ...base,
      knownRejectedDomains: ['otra-industria.co', 'descartado.co', 'vivo.co'],
    });
    assert.deepEqual(r.domains, ['cuenta.co', 'vivo.co', 'descartado.co', 'visto.co', 'otra-industria.co']);
    assert.equal(r.telemetry.from_authority, 2);
    assert.equal(r.telemetry.from_recent_seen, 2);
    assert.equal(r.telemetry.from_known_rejected, 1);
    assert.equal(r.telemetry.sent, 5);
  });

  it('🔴 con el tope lleno, ningún ya entregado entra (se cuentan como omitidos)', () => {
    const r = resolveApolloSeenDomainExclusion({ ...base, knownRejectedDomains: ['x.co', 'y.co'], cap: 3 });
    assert.equal(r.domains.length, 3);
    assert.equal(r.telemetry.from_known_rejected, 0);
    assert.equal(r.telemetry.omitted_due_to_cap, 3);
  });

  it('lo que el tope de entrega liberó NO vuelve a excluirse aunque llegue como entregado', () => {
    const r = resolveApolloSeenDomainExclusion({
      ...base,
      releasedDomains: ['liberado.co'],
      knownRejectedDomains: ['liberado.co'],
    });
    assert.equal(r.domains.includes('liberado.co'), false);
  });

  it('sin ya entregados, la lista es la de antes', () => {
    const before = resolveApolloSeenDomainExclusion(base);
    assert.deepEqual(before.domains, ['cuenta.co', 'vivo.co', 'descartado.co', 'visto.co']);
    assert.equal(before.telemetry.from_known_rejected, 0);
  });
});

describe('asistente — los ya entregados llegan al plan', () => {
  it('el asistente pasa `knownRejectedDomains` del lector al plan', () => {
    const wizard = readFileSync(
      path.join(REPO_ROOT, 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts'),
      'utf8',
    );
    assert.match(wizard, /knownRejectedDomains:\s*apolloExclusionSellup\?\.knownRejectedDomains \?\? \[\]/);
  });
});

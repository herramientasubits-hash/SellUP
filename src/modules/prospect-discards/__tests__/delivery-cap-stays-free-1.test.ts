/**
 * AGENT1-DELIVERY-CAP-STAYS-FREE-1 — lo que el tope de entrega deja fuera queda
 * LIBRE para otro vendedor, no oculto.
 *
 * Defecto de #521 encontrado en Producción (01-10, Chile × Salud, lote
 * `34eeac5a`: 2 recortadas): Apollo ya las había registrado como vistas y la
 * exclusión de la siguiente búsqueda sólo liberaba lo DESCARTADO en SellUp, así
 * que quedaban ocultas ~30 días para todos.
 *
 *   § 1 · las filas de «Descartadas» para lo recortado;
 *   § 2 · la exclusión de Apollo las libera (y lo vivo sigue ganando);
 *   § 3 · el runner las registra tras escribir.
 *
 *   LIVE_PROVIDER_CALLS = 0 · CREDITS = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DELIVERY_CAP_DISPOSITION,
  DELIVERY_CAP_REASON_CODE,
  buildDeliveryCappedDispositionRows,
} from '../delivery-capped-dispositions';
import { loadApolloExclusionSellupDomains } from '@/server/prospect-batches/provider-seen/apollo-exclusion-sellup-domains.server';
import { resolveApolloSeenDomainExclusion } from '@/modules/prospect-batches/provider-seen/apollo-seen-domain-exclusion';
import type { ProviderSeenMemory } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';

describe('§ 1 — las filas de «Descartadas»', () => {
  const rows = buildDeliveryCappedDispositionRows({
    batchId: 'b-1',
    sourcePrimary: 'apollo',
    requestedCountryCode: 'CL',
    requestedIndustry: 'Salud & Farmacéuticos',
    companies: [
      { name: 'Clínica Uno', domain: 'https://www.ClinicaUno.cl/inicio', linkedinUrl: 'https://linkedin.com/company/clinica-uno', countryCode: 'CL' },
      { name: 'Clínica Uno (copia)', domain: 'clinicauno.cl', linkedinUrl: null, countryCode: 'CL' },
      { name: 'Sin Sitio', domain: null, linkedinUrl: null, countryCode: null },
      { name: '  ', domain: 'x.cl', linkedinUrl: null, countryCode: 'CL' },
    ],
  });

  it('🔴 motivo y disposición del tope, dominio normalizado, deduplicadas por identidad', () => {
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.disposition, DELIVERY_CAP_DISPOSITION);
    assert.equal(rows[0]!.reasonCode, DELIVERY_CAP_REASON_CODE);
    assert.equal(rows[0]!.domain, 'clinicauno.cl');
    assert.equal(rows[0]!.sourceKey, 'delivery_cap:clinicauno.cl');
    assert.equal((rows[0]!.evidence as Record<string, unknown>).linkedin_url, 'https://linkedin.com/company/clinica-uno');
  });

  it('sin sitio se identifica por nombre y toma el país pedido', () => {
    assert.equal(rows[1]!.sourceKey, 'delivery_cap:name:sin sitio');
    assert.equal(rows[1]!.domain, null);
    assert.equal(rows[1]!.countryCode, 'CL');
  });
});

// ─── § 2 ──────────────────────────────────────────────────────────────────────

function client(opts: { capped?: string[]; liveByDomain?: Array<{ domain: string; status: string }>; dispositionsError?: boolean }) {
  return {
    from(table: string) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        not() { return builder; },
        order() { return builder; },
        async limit() { return { data: [], error: null }; },
        async in(_c: string, values: unknown[]) {
          const wanted = new Set(values as string[]);
          if (table === 'prospect_discarded_dispositions') {
            if (opts.dispositionsError) return { data: null, error: { message: 'x' } };
            return { data: (opts.capped ?? []).filter((d) => wanted.has(d)).map((domain) => ({ domain })), error: null };
          }
          return { data: (opts.liveByDomain ?? []).filter((r) => wanted.has(r.domain)), error: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

function memory(domains: string[]): ProviderSeenMemory {
  return {
    providerEntityIds: new Set(),
    normalizedDomains: new Set(domains),
    domainLastSeenAt: new Map(domains.map((d) => [d, '2026-09-30T10:00:00.000Z'])),
  };
}

describe('§ 2 — la exclusión de Apollo las libera', () => {
  it('🔴 un dominio visto que en SellUp sólo existe como recortado por el tope ⇒ NO se excluye', async () => {
    const seen = ['recortada.cl', 'vista.cl'];
    const r = await loadApolloExclusionSellupDomains(client({ capped: ['recortada.cl'] }), {
      countryCode: 'CL',
      seenDomains: seen,
    });
    assert.deepEqual(r.releasedDomains, ['recortada.cl']);
    const plan = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: [],
      providerSeenMemory: memory(seen),
      releasedDomains: r.releasedDomains,
      now: new Date('2026-10-01T12:00:00.000Z'),
    });
    assert.deepEqual(plan.domains, ['vista.cl']);
  });

  it('si otro vendedor ya la tiene viva, sigue excluida (lo vivo manda)', async () => {
    const r = await loadApolloExclusionSellupDomains(
      client({ capped: ['tomada.cl'], liveByDomain: [{ domain: 'tomada.cl', status: 'needs_review' }] }),
      { countryCode: 'CL', seenDomains: ['tomada.cl'] },
    );
    assert.deepEqual(r.releasedDomains, []);
  });

  it('una lectura rota de Descartadas no libera nada y lo declara', async () => {
    const r = await loadApolloExclusionSellupDomains(client({ capped: ['recortada.cl'], dispositionsError: true }), {
      countryCode: 'CL',
      seenDomains: ['recortada.cl'],
    });
    assert.deepEqual(r.releasedDomains, []);
    assert.equal(r.degraded, true);
  });
});

// ─── § 3 ──────────────────────────────────────────────────────────────────────

describe('§ 3 — el runner registra lo recortado', () => {
  it('tras escribir, guarda las filas del tope en «Descartadas»', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../../../server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.match(src, /const deliveryCapped = writerResult\.deliveryCappedCompanies \?\? \[\];/);
    assert.match(src, /persistDiscardedDispositionRows\(\s*buildDeliveryCappedDispositionRows\(/);
  });
});

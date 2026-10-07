/**
 * AGENT1-FREE-SOURCE-UNVERIFIED-1 — una empresa de un catálogo oficial SIN sitio
 * web no cuenta para la meta: va a «Descartadas» para que Claude busque su sitio.
 *
 * Decisión de la dueña (2026-10-01). Medido en Producción (México × Tecnología,
 * lote `79c79bd0`): DENUE dejó 20 filas sin dominio, contó 5 como aceptadas y
 * Apollo y Lusha no corrieron.
 *
 *   § 1 · el reparto (con dominio / sin dominio) y las filas de «Descartadas»;
 *   § 2 · la capa gratuita real: lo que se guarda, lo que se descarta y el hueco;
 *   § 3 · el rescate con Claude recoge exactamente estas filas.
 *
 *   LIVE_PROVIDER_CALLS = 0 · CREDITS = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  FREE_SOURCE_MISSING_DOMAIN_REASON_CODE,
  FREE_SOURCE_UNVERIFIED_MAX_DISPOSITIONS,
  buildUnverifiedFreeDispositionRows,
  partitionFreeCompaniesByDomain,
} from '../free-source-unverified';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '../run-prepaid-novelty-discovery.server';
import type { CountrySourceCompany } from '../country-source-types';
import type { PrePaidNoveltyGateResult } from '../run-prepaid-novelty-gate';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { CreateDiscardedDispositionInput } from '@/modules/prospect-discards/types';
import { isDomainSearchCandidate } from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/domain-search';

const TARGET = 5;

function company(i: number, domain: string | null): CountrySourceCompany {
  return {
    recordIdentityKey: `denue:${i}`,
    legalName: `EMPRESA ${i}`,
    normalizedLegalName: `empresa ${i}`,
    taxId: i % 2 === 0 ? `RFC${i}` : null,
    taxIdentifierType: i % 2 === 0 ? 'RFC' : null,
    countryCode: 'MX',
    city: 'Monterrey',
    region: 'Nuevo León',
    domain,
    declaredIndustry: 'Edición de software',
    industryCode: '5112',
    coarseSector: null,
  } as unknown as CountrySourceCompany;
}

// ─── § 1 ──────────────────────────────────────────────────────────────────────

describe('§ 1 — el reparto y las filas de «Descartadas»', () => {
  it('con dominio (no vacío) / sin dominio', () => {
    const list = [company(1, 'a.com.mx'), company(2, null), company(3, '  '), company(4, 'b.mx')];
    const { withDomain, withoutDomain } = partitionFreeCompaniesByDomain(list);
    assert.deepEqual(withDomain.map((c) => c.recordIdentityKey), ['denue:1', 'denue:4']);
    assert.deepEqual(withoutDomain.map((c) => c.recordIdentityKey), ['denue:2', 'denue:3']);
  });

  it('🔴 cada fila sin sitio va con el motivo que el buscador de Claude recoge', () => {
    const rows = buildUnverifiedFreeDispositionRows({
      batchId: 'b-1',
      countryCode: 'MX',
      companies: [company(2, null), company(5, 'tiene.com')],
    });
    assert.equal(rows.length, 1, 'una con dominio nunca se descarta por esto');
    const row = rows[0]!;
    assert.equal(row.reasonCode, FREE_SOURCE_MISSING_DOMAIN_REASON_CODE);
    assert.equal(row.sourcePrimary, 'public_source');
    assert.equal(row.disposition, 'final_validation_rejected');
    assert.equal(row.domain, null);
    assert.equal(row.sourceKey, 'free:denue:2');
    assert.equal(row.name, 'EMPRESA 2');
    assert.equal((row.evidence as Record<string, unknown>).provider_raw_name, 'EMPRESA 2');
  });

  it('sin PII: el identificador fiscal sólo como PRESENCIA, nunca su valor', () => {
    const [row] = buildUnverifiedFreeDispositionRows({ batchId: 'b-1', countryCode: 'MX', companies: [company(2, null)] });
    const json = JSON.stringify(row);
    assert.ok(!json.includes('RFC2'));
    assert.equal((row!.evidence as Record<string, unknown>).tax_identifier_present, true);
  });

  it('acotado y sin filas sin nombre', () => {
    const many = Array.from({ length: FREE_SOURCE_UNVERIFIED_MAX_DISPOSITIONS + 10 }, (_, i) => company(i, null));
    assert.equal(
      buildUnverifiedFreeDispositionRows({ batchId: 'b', countryCode: 'MX', companies: many }).length,
      FREE_SOURCE_UNVERIFIED_MAX_DISPOSITIONS,
    );
    const nameless = { ...company(9, null), legalName: null, normalizedLegalName: null } as CountrySourceCompany;
    assert.equal(buildUnverifiedFreeDispositionRows({ batchId: 'b', countryCode: 'MX', companies: [nameless] }).length, 0);
  });
});

// ─── § 2 ──────────────────────────────────────────────────────────────────────

type Harness = {
  persisted: number[];
  discards: CreateDiscardedDispositionInput[][];
  deps: PrePaidNoveltyDiscoveryDeps;
};

function harness(companies: CountrySourceCompany[], opts: { recordFails?: boolean } = {}): Harness {
  const persisted: number[] = [];
  const discards: CreateDiscardedDispositionInput[][] = [];
  const context = buildPrePaidNoveltyContext({
    requestedTarget: TARGET,
    countryCode: 'MX',
    macroIndustryKey: 'technology',
    freeSource: {
      sourceKey: 'mx_denue_discovery',
      attempted: true,
      rawReturned: companies.length,
      macroConfirmed: companies.length,
      ambiguous: 0,
      rejected: 0,
      sellupKnown: 0,
      hubspotKnown: 0,
      acceptedNovel: companies.length,
      failed: false,
      failureCode: null,
    },
  });
  const gateResult = {
    context,
    exclusionPlan: { available: 0, availableValues: [], sent: [], omittedDueToCap: 0 },
    providerExclusionPlan: planProviderExclusions('apollo', {}),
    providerSeen: PROVIDER_SEEN_LOAD_EMPTY,
    providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
    acceptedCompanies: companies,
    telemetry: {},
  } as unknown as PrePaidNoveltyGateResult;
  return {
    persisted,
    discards,
    deps: {
      runGate: async () => gateResult,
      persist: async (_client, input) => {
        persisted.push(input.companies.length);
        return { batchId: 'b-1', writtenCount: input.companies.length, skippedCount: 0, failed: false };
      },
      maxDeliveredCandidates: 10,
      recordUnverified: async (rows) => {
        if (opts.recordFails) throw new Error('boom');
        discards.push([...rows]);
        return { attempted: rows.length, persisted: rows.length, failed: 0, errors: [] };
      },
    },
  };
}

async function run(h: Harness, partialGapSupported = true) {
  return runPrePaidNoveltyDiscovery(
    {} as unknown as SupabaseClient,
    {
      provider: 'apollo',
      countryCode: 'MX',
      countryName: 'México',
      macroIndustryKey: 'technology',
      requestedTarget: TARGET,
      requestedByUserId: 'u-1',
      resolveBatchId: async () => 'b-1',
      partialGapSupported,
    } as Parameters<typeof runPrePaidNoveltyDiscovery>[1],
    h.deps,
  );
}

describe('§ 2 — la capa gratuita real', () => {
  // AGENT1-FREE-LAYER-OVERFLOW-STAYS-IN-SOURCE-1 — a Descartadas sólo van las sin
  // sitio que caben bajo el tope; las demás siguen en la fuente para la próxima búsqueda.
  it('🔴 14 con sitio y 6 sin: se guardan 10 (tope), ninguna a Descartadas (no cabe ninguna más), la meta se cubre', async () => {
    const list = [
      ...Array.from({ length: 14 }, (_, i) => company(i, `e${i}.com.mx`)),
      ...Array.from({ length: 6 }, (_, i) => company(100 + i, null)),
    ];
    const h = harness(list);
    const out = await run(h);
    assert.deepEqual(h.persisted, [10]);
    assert.equal(h.discards.length, 0);
    assert.equal(out.residualGap, 0);
    assert.equal((out.telemetry as Record<string, unknown>).unverified_without_domain, 6);
    assert.equal((out.telemetry as Record<string, unknown>).unverified_sent_to_discards, 0);
    assert.equal((out.telemetry as Record<string, unknown>).unverified_left_in_source, 6);
  });

  it('🔴 4 con sitio y 10 sin: se guardan 4 y van a Descartadas las 6 que caben, en orden', async () => {
    const list = [
      ...Array.from({ length: 4 }, (_, i) => company(i, `e${i}.com.mx`)),
      ...Array.from({ length: 10 }, (_, i) => company(100 + i, null)),
    ];
    const h = harness(list);
    const out = await run(h);
    assert.deepEqual(h.persisted, [4]);
    assert.equal(h.discards[0]!.length, 6);
    assert.equal((out.telemetry as Record<string, unknown>).unverified_left_in_source, 4);
  });

  // AGENT1-FREE-LAYER-WINDOW-PER-BATCH-1 — Prod 07-10, Costa Rica × Tecnología (25fd9c3e):
  // la capa gratuita corrió dos veces en la misma búsqueda y registró 10 + 10.
  it('🔴 segunda pasada en el mismo lote: descuenta las sin web que ya esperan al rescate', async () => {
    const h = harness(Array.from({ length: 20 }, (_, i) => company(i, null)));
    const asked: string[] = [];
    h.deps.countPendingUnverified = async (_client, batchId) => (asked.push(batchId), 10);
    const out = await run(h);
    assert.deepEqual(asked, ['b-1']);
    assert.equal(h.discards.length, 0, 'ya hay 10 esperando: no cabe ninguna más');
    assert.equal((out.telemetry as Record<string, unknown>).unverified_left_in_source, 20);
  });

  it('con 7 esperando y 0 con web, caben 3', async () => {
    const h = harness(Array.from({ length: 20 }, (_, i) => company(i, null)));
    h.deps.countPendingUnverified = async () => 7;
    await run(h);
    assert.equal(h.discards[0]!.length, 3);
  });

  it('si la lectura falla cuenta 0 (como antes)', async () => {
    const h = harness(Array.from({ length: 20 }, (_, i) => company(i, null)));
    h.deps.countPendingUnverified = async () => {
      throw new Error('boom');
    };
    await run(h);
    assert.equal(h.discards[0]!.length, 10);
  });

  it('🔴 el caso medido: 20 SIN sitio ⇒ no se guarda ninguna, 10 a Descartadas (las que caben), y los de pago corren por TODO el objetivo', async () => {
    const h = harness(Array.from({ length: 20 }, (_, i) => company(i, null)));
    const out = await run(h);
    assert.deepEqual(h.persisted, [], 'no se llama a guardar candidatas');
    assert.equal(h.discards[0]!.length, 10);
    assert.equal(out.residualGap, TARGET);
    assert.equal(out.acceptedBeforeProvider, 0);
    assert.equal(out.providerRequired, true);
    assert.equal(out.persistedCount, 0);
  });

  it('3 con sitio ⇒ cuentan 3 y faltan 2 (hueco parcial)', async () => {
    const h = harness([company(1, 'a.mx'), company(2, 'b.mx'), company(3, 'c.mx'), company(4, null)]);
    const out = await run(h);
    assert.deepEqual(h.persisted, [3]);
    assert.equal(out.residualGap, 2);
  });

  it('una escritura de Descartadas que falla no tumba la capa gratuita', async () => {
    const h = harness([company(1, 'a.mx'), company(2, null)], { recordFails: true });
    const out = await run(h);
    assert.deepEqual(h.persisted, [1]);
    assert.equal((out.telemetry as Record<string, unknown>).unverified_sent_to_discards, 0);
  });

  it('todas con sitio ⇒ nada a Descartadas (comportamiento de siempre)', async () => {
    const h = harness([company(1, 'a.mx'), company(2, 'b.mx')]);
    await run(h);
    assert.equal(h.discards.length, 0);
  });
});

// ─── § 3 ──────────────────────────────────────────────────────────────────────

describe('§ 3 — el rescate con Claude recoge estas filas', () => {
  it('🔴 sin dominio y con el motivo del buscador ⇒ candidata a búsqueda de sitio', () => {
    const [row] = buildUnverifiedFreeDispositionRows({ batchId: 'b', countryCode: 'MX', companies: [company(7, null)] });
    assert.equal(isDomainSearchCandidate({ domain: row!.domain ?? null, reason_code: row!.reasonCode ?? null }), true);
  });
});

// ─── § 4 — el cableado de producción ──────────────────────────────────────────

describe('§ 4 — en producción las empresas sin sitio SÍ llegan a «Descartadas»', () => {
  it('🔴 PRODUCTION_DEPS cablea la escritura real (y las deps inyectadas sin ella no escriben)', () => {
    const source = readFileSync(path.join(__dirname, '..', 'run-prepaid-novelty-discovery.server.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.match(
      source,
      /const PRODUCTION_DEPS: PrePaidNoveltyDiscoveryDeps = \{[^}]*recordUnverified: persistDiscardedDispositionRows,/,
    );
    assert.match(source, /&& deps\.recordUnverified\)/);
  });
});

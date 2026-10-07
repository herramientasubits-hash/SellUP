/**
 * Agente 1 — lo que no cabe en la búsqueda no se pierde (Prod 07-10, Ecuador × Retail,
 * lote 2aab8384):
 *
 *   1. AGENT1-FREE-LAYER-OVERFLOW-STAYS-IN-SOURCE-1 — de las empresas sin web de la
 *      capa gratuita sólo van a Descartadas las que el rescate puede meter en ESTA
 *      búsqueda; las demás siguen en la fuente. Y una descartada sin web que Claude
 *      nunca buscó (el lote ya estaba lleno) se vuelve a ofrecer.
 *   2. AGENT1-RESCUE-SLOTS-REQUESTED-INDUSTRY-1 — una empresa de OTRA industria no
 *      ocupa uno de los 10 lugares.
 *   3. AGENT1-RESCUED-FREE-LAYER-KEEPS-DATA-1 — la que vuelve de Descartadas trae el
 *      tamaño oficial; Ecuador muestra la industria.
 *
 * Puro: sin red ni base de datos. Las comprobaciones de cableado leen el código sin
 * comentarios.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildUnverifiedFreeDispositionRows,
  selectUnverifiedForThisSearch,
} from '../free-source-unverified';
import {
  isUnsearchedFreeLayerDiscard,
  UNSEARCHED_DISCARD_GRACE_MS,
} from '../country-source-prior-sightings';
import { buildCountrySourceOfficialWorkforce, type CountrySourceCompany } from '../country-source-types';
import {
  FREE_SOURCE_OFFICIAL_WORKFORCE_EVIDENCE_KEY,
  officialWorkforceFromDisposition,
} from '@/modules/prospect-discards/official-workforce-from-disposition';
import { keepsDeliverySlot } from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch';

const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const source = (path: string) => strip(readFileSync(join(process.cwd(), path), 'utf8'));
const DISCOVERY = 'src/server/prospect-batches/country-source-discovery';

function company(overrides: Partial<CountrySourceCompany> = {}): CountrySourceCompany {
  return {
    recordIdentityKey: 'tax:1790016919001',
    legalName: 'CORPORACION FAVORITA C.A.',
    normalizedLegalName: 'CORPORACION FAVORITA',
    taxId: '1790016919001',
    taxIdentifierType: 'RUC',
    countryCode: 'EC',
    city: 'QUITO',
    region: 'PICHINCHA',
    domain: null,
    declaredIndustry: 'Retail',
    industryCode: 'G4711.01',
    coarseSector: null,
    officialMacroIndustry: { macroIndustryKeys: ['retail'], tableVersion: 'v2' },
    officialWorkforce: buildCountrySourceOfficialWorkforce(12033, 2025, 'Supercias'),
    ...overrides,
  };
}

describe('1. las sin web que no caben siguen en la fuente', () => {
  const eighty = Array.from({ length: 80 }, (_, i) => `c${i}`);

  it('a Descartadas sólo van tantas como lugares deja libres la capa gratuita, en su orden', () => {
    assert.deepEqual(selectUnverifiedForThisSearch(eighty, 10, 0), eighty.slice(0, 10));
    assert.deepEqual(selectUnverifiedForThisSearch(eighty, 10, 7), eighty.slice(0, 3));
    assert.deepEqual(selectUnverifiedForThisSearch(eighty, 10, 10), []);
    assert.deepEqual(selectUnverifiedForThisSearch(eighty, 10, 12), []);
  });

  it('sin tope de entrega: todas, como antes', () => {
    assert.equal(selectUnverifiedForThisSearch(eighty, null, 3).length, 80);
  });

  it('la capa gratuita usa la selección y deja constancia de lo que siguió en la fuente', () => {
    const runner = source(`${DISCOVERY}/run-prepaid-novelty-discovery.server.ts`);
    assert.match(runner, /selectUnverifiedForThisSearch\(\s*withoutDomain,\s*deliveryCap,\s*deliveredFree\.length \+ alreadyWaiting,?\s*\)/);
    // AGENT1-FREE-LAYER-WINDOW-PER-BATCH-1 — en producción se cuentan las que ya esperan en el lote.
    assert.match(runner, /countPendingUnverified: countPendingFreeSourceUnverified/);
    assert.match(runner, /\.is\('evidence->claude_rescue->>decision', null\)/);
    assert.match(runner, /companies: sentToDiscards/);
    assert.match(runner, /unverified_left_in_source:/);
    assert.doesNotMatch(runner, /companies: withoutDomain/);
  });
});

describe('1b. una descartada sin web que Claude nunca buscó se vuelve a ofrecer', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const old = new Date(now - UNSEARCHED_DISCARD_GRACE_MS - 1).toISOString();
  const recent = new Date(now - 5 * 60 * 1000).toISOString();
  const row = (overrides: Record<string, string | null>) => ({
    status: 'discarded',
    reason_code: 'missing_domain_final',
    decision: null,
    created_at: old,
    ...overrides,
  });

  it('sin web, sin decisión del rescate y con más de una hora: vuelve', () => {
    assert.equal(isUnsearchedFreeLayerDiscard(row({}), now), true);
    assert.equal(isUnsearchedFreeLayerDiscard(row({ decision: '' }), now), true);
  });

  it('el rescate todavía puede llegar (menos de una hora): sigue bloqueada', () => {
    assert.equal(isUnsearchedFreeLayerDiscard(row({ created_at: recent }), now), false);
    assert.equal(isUnsearchedFreeLayerDiscard(row({ created_at: null }), now), false);
  });

  it('Claude ya la buscó o la decidió (cualquier decisión): no se recicla', () => {
    for (const decision of ['keep', 'unchanged', 'discard', 'duplicate', 'reassign', 'in_progress', 'retryable']) {
      assert.equal(isUnsearchedFreeLayerDiscard(row({ decision }), now), false, decision);
    }
  });

  it('otro motivo o ya enviada a revisión: no se recicla', () => {
    assert.equal(isUnsearchedFreeLayerDiscard(row({ reason_code: 'sector_subindustry_rejected_final' }), now), false);
    assert.equal(isUnsearchedFreeLayerDiscard(row({ status: 'sent_to_review' }), now), false);
  });

  it('la regla es general: la puerta de la capa gratuita y los lectores de Ecuador, Argentina, RD y Colombia', () => {
    for (const file of [
      'prepaid-novelty-gate.server.ts',
      'country-source-prior-sightings.ts',
      'ar-rns-snapshot-query.ts',
      'do-dgii-snapshot-query.ts',
      'co-siis-snapshot-query.ts',
    ]) {
      const code = source(`${DISCOVERY}/${file}`);
      assert.match(code, /isUnsearchedFreeLayerDiscard\(/, file);
      assert.match(code, /created_at|PRIOR_SIGHTING_DISPOSITION_COLUMNS/, file);
    }
  });
});

describe('2. una empresa de otra industria no ocupa lugar de la búsqueda', () => {
  it('sólo una admitida de la industria pedida conserva su lugar', () => {
    assert.equal(keepsDeliverySlot('admitted'), true);
    for (const tag of ['reassigned', 'kept', 'failed', 'skipped', 'capped', 'discarded'] as const) {
      assert.equal(keepsDeliverySlot(tag), false, tag);
    }
  });

  it('los lugares libres no cuentan las reasignadas (sin perder las que no tienen decisión)', () => {
    const server = source('src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.server.ts');
    assert.match(server, /deliverySlots: async \(batchId\) => \{[\s\S]*?\.or\(NOT_REASSIGNED_FILTER\)/);
    assert.match(
      server,
      /NOT_REASSIGNED_FILTER =\s*'metadata->claude_rescue->>decision\.is\.null,metadata->claude_rescue->>decision\.neq\.reassign'/,
    );
  });

  it('un candidato que pasa a otra industria libera su lugar; reabrir descartes por sector no ocupa lugares', () => {
    const rescue = source('src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.ts');
    assert.match(rescue, /if \(outcome\.tag === 'reassigned'\) ctx\.slots\.remaining\+\+/);
    assert.match(rescue, /rescueCandidateFreeingSlot\(item\.row, ctx, deps\)/);
    const stored = /async function reassignStoredSectorMismatches[\s\S]*?\n\}\n/.exec(rescue)?.[0] ?? '';
    assert.ok(stored.length > 0);
    assert.doesNotMatch(stored, /slots/);
  });
});

describe('3. la que vuelve de Descartadas conserva sus datos oficiales', () => {
  it('la fila de Descartadas guarda el tamaño oficial de la fuente', () => {
    const [row] = buildUnverifiedFreeDispositionRows({ batchId: 'b1', countryCode: 'EC', companies: [company()] });
    assert.deepEqual(row.evidence?.[FREE_SOURCE_OFFICIAL_WORKFORCE_EVIDENCE_KEY], {
      workers: 12033,
      year: 2025,
      source_label: 'Supercias',
    });
    const [none] = buildUnverifiedFreeDispositionRows({
      batchId: 'b1',
      countryCode: 'EC',
      companies: [company({ officialWorkforce: null })],
    });
    assert.equal(FREE_SOURCE_OFFICIAL_WORKFORCE_EVIDENCE_KEY in (none.evidence ?? {}), false);
  });

  it('al enviarla a revisión, el tamaño llega a la ficha como estimado oficial (nunca confirmado)', () => {
    const evidence = { [FREE_SOURCE_OFFICIAL_WORKFORCE_EVIDENCE_KEY]: { workers: 12033, year: 2025, source_label: 'Supercias' } };
    assert.deepEqual(officialWorkforceFromDisposition({ sourcePrimary: 'public_source', evidence }), {
      employee_count: 12033,
      employee_count_status: 'estimated_100_plus',
      employee_count_source: 'Supercias 2025',
      employee_count_confidence: 90,
    });
    const small = { [FREE_SOURCE_OFFICIAL_WORKFORCE_EVIDENCE_KEY]: { workers: 60, year: null, source_label: 'SII' } };
    assert.deepEqual(officialWorkforceFromDisposition({ sourcePrimary: 'public_source', evidence: small }), {
      employee_count: 60,
      employee_count_status: 'estimated_under_100',
      employee_count_source: 'SII',
      employee_count_confidence: 90,
    });
  });

  it('sin dato válido o de un proveedor de pago: nada', () => {
    const evidence = { [FREE_SOURCE_OFFICIAL_WORKFORCE_EVIDENCE_KEY]: { workers: 12033, year: 2025, source_label: 'Supercias' } };
    assert.deepEqual(officialWorkforceFromDisposition({ sourcePrimary: 'apollo', evidence }), {});
    for (const bad of [{ workers: 0, source_label: 'X' }, { workers: 3.5, source_label: 'X' }, { workers: 10, source_label: ' ' }, null, 'x']) {
      assert.deepEqual(
        officialWorkforceFromDisposition({ sourcePrimary: 'public_source', evidence: { [FREE_SOURCE_OFFICIAL_WORKFORCE_EVIDENCE_KEY]: bad } }),
        {},
      );
    }
    assert.deepEqual(officialWorkforceFromDisposition({ sourcePrimary: 'public_source', evidence: null }), {});
  });

  it('enviar a revisión aplica el tamaño oficial DESPUÉS de lo que trae el rescate (gana el dato oficial)', () => {
    const core = source('src/modules/prospect-discards/send-to-review-core.ts');
    const origin = core.indexOf('...(origin?.columns ?? {})');
    const official = core.indexOf('...officialWorkforceFromDisposition(');
    assert.ok(origin > 0 && official > origin);
  });

  it('Ecuador muestra la industria de la tabla oficial en la columna Industria', () => {
    const adapter = source(`${DISCOVERY}/ec-scvs-directory-discovery-adapter.ts`);
    assert.match(adapter, /declaredIndustry: getMacroIndustryByKey\(macroIndustryKey\)\?\.displayName \?\? null/);
  });
});

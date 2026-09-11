/**
 * hardening-cut4-known-seed-persistence.test.ts — la fila de la siembra es
 * DURABLE, IDEMPOTENTE y NO pisa el veredicto de Apollo.
 *
 * AGENT1-HARDENING-CUT-4.
 *
 * El corte hace que una empresa retirada por `known_domain_seed` produzca un
 * registro de descarte. Este archivo comprueba lo que pasa cuando ese registro
 * llega a la base, con un doble de Supabase que modela la clave real de la
 * tabla —`(batch_id, source_key)` con `ON CONFLICT DO NOTHING`— en vez de
 * aceptar cualquier cosa:
 *
 *   · una segunda corrida sobre el mismo lote NO duplica y NO reescribe;
 *   · una fila que Apollo ya escribió para esa empresa en el MISMO lote
 *     SOBREVIVE con su disposición y su motivo originales.
 *
 * 🔴 El cliente se INYECTA. La vía anterior —`mock.module('@supabase/supabase-js')`—
 * dejó de funcionar en Node 24: `options.namedExports` está deprecado, el mock
 * no se aplica y el cliente REAL sale a la red (`fetch failed`, DNS). Un
 * invariante de escritura no puede depender de una API experimental que cambia
 * entre versiones del runner.
 *
 * Sin red, sin base real, sin proveedor, 0 créditos.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { computeDiscardDispositionSourceKey } from '../mapping';
import {
  persistLushaRejectedDispositions,
  type LushaDiscardRecordLike,
  type LushaDiscardWriterClientFactory,
} from '../lusha-pipeline-writer.server';

/** § CUT-C.2 — identidad de corrida exigida por el escritor. */
const WIZARD_RUN_ID = 'wizard-run-fixture-1';
const CLIENT_REQUEST_ID = 'client-request-fixture-1';

/**
 * 🔴 FIDELIDAD DEL ARNÉS — el doble se comporta como Postgres, no como un
 * buzón. Un doble que aceptara todo dejaría pasar exactamente el defecto que
 * este archivo vigila: una segunda escritura sobrescribiendo el veredicto de
 * la pierna anterior.
 */
type StoredRow = Record<string, unknown>;
const table = new Map<string, StoredRow>();

function keyOf(row: StoredRow): string {
  return `${String(row.batch_id)}::${String(row.source_key)}`;
}

/**
 * 🔴 FIDELIDAD DEL ARNÉS — el doble se comporta como Postgres, no como un
 * buzón. Un doble que aceptara todo dejaría pasar exactamente el defecto que
 * este archivo vigila: una segunda escritura sobrescribiendo el veredicto de
 * la pierna anterior.
 */
const clientFactory: LushaDiscardWriterClientFactory = () => ({
  from: () => ({
    upsert: (payload: StoredRow[], options: { ignoreDuplicates: boolean }) => {
      const inserted: StoredRow[] = [];
      for (const row of payload) {
        const key = keyOf(row);
        if (table.has(key)) {
          // ON CONFLICT DO NOTHING: la fila existente NO se toca y no vuelve
          // en `.select()`.
          if (options.ignoreDuplicates !== true) table.set(key, row);
          continue;
        }
        table.set(key, row);
        inserted.push(row);
      }
      return {
        select: () =>
          Promise.resolve({
            data: inserted.map((_row, i) => ({ id: `row-${i}` })),
            error: null,
          }),
      };
    },
  }),
});

beforeEach(() => {
  table.clear();
});

const BATCH_ID = 'batch-cut4';

/** El registro que el corte hace que la corrida emita. */
const SEED_RECORD: LushaDiscardRecordLike = {
  name: 'Clínica Conocida',
  domain: 'conocida.com',
  providerCompanyId: 'p-known',
  linkedinUrl: 'https://linkedin.com/company/conocida',
  industry: 'Hospitals & Clinics',
  countryCode: 'CO',
  disposition: 'sellup_duplicate',
  reasonCode: 'known_domain_seed',
  reasonDetail: 'conocida.com',
  roundOrigin: 'lusha_branch_0_page_0',
  evidence: {
    provider: 'lusha',
    discard_kind: 'known_domain_seed',
    known_seed_matched_domain: 'conocida.com',
    suppression_stage: 'run_identity_dedupe',
  },
};

function persist(records: readonly LushaDiscardRecordLike[]) {
  return persistLushaRejectedDispositions({
    batchId: BATCH_ID,
    wizardRunId: WIZARD_RUN_ID,
    clientRequestId: CLIENT_REQUEST_ID,
    requestedCountryCode: 'CO',
    requestedIndustry: 'Salud',
    records,
    clientFactory,
  });
}

// ── § 1 · durable ────────────────────────────────────────────────────────────

describe('CUT-4 § 1 · la fila de la siembra aterriza con todo lo que hay que preservar', () => {
  it('escribe batch_id, source_key, provider, disposition y evidencia', async () => {
    const result = await persist([SEED_RECORD]);
    assert.equal(result.attempted, 1);
    assert.equal(result.persisted, 1);
    assert.equal(result.conflicts, 0);
    assert.equal(result.failed, 0);

    const stored = [...table.values()][0];
    assert.ok(stored);
    assert.equal(stored.batch_id, BATCH_ID);
    assert.equal(
      stored.source_key,
      computeDiscardDispositionSourceKey({ domain: 'conocida.com', name: 'Clínica Conocida' }),
    );
    assert.equal(stored.source_primary, 'lusha');
    assert.equal(stored.disposition, 'sellup_duplicate');
    assert.equal(stored.reason_code, 'known_domain_seed');
    assert.equal(stored.round_origin, 'lusha_branch_0_page_0');
    const evidence = stored.evidence as Record<string, unknown>;
    assert.equal(evidence.discard_kind, 'known_domain_seed');
    assert.equal(evidence.known_seed_matched_domain, 'conocida.com');
    assert.equal(evidence.suppression_stage, 'run_identity_dedupe');
  });
});

// ── § 2 · idempotente ────────────────────────────────────────────────────────

describe('CUT-4 § 2 · re-ejecución ⇒ ON CONFLICT DO NOTHING', () => {
  it('la segunda corrida no duplica: una fila, y la colisión se cuenta', async () => {
    await persist([SEED_RECORD]);
    const second = await persist([SEED_RECORD]);

    assert.equal(table.size, 1, '🔴 una empresa, una fila, por muchas corridas que haya');
    assert.equal(second.attempted, 1);
    assert.equal(second.persisted, 0);
    assert.equal(second.conflicts, 1, 'la colisión se declara, no se esconde');
    assert.equal(second.failed, 0);
  });

  it('la fila original conserva su evidencia tras la segunda corrida', async () => {
    await persist([SEED_RECORD]);
    await persist([
      { ...SEED_RECORD, roundOrigin: 'lusha_branch_2_page_1', reasonDetail: 'otra-cosa' },
    ]);
    const stored = [...table.values()][0];
    assert.equal(stored.round_origin, 'lusha_branch_0_page_0', '🔴 sobrevive el PRIMER veredicto');
    assert.equal(stored.reason_detail, 'conocida.com');
  });
});

// ── § 3 · Apollo y Lusha no se pisan ─────────────────────────────────────────

describe('CUT-4 § 3 · el veredicto de Apollo sobrevive intacto', () => {
  it('Lusha no reescribe una fila que Apollo dejó en el MISMO lote', async () => {
    // Apollo descartó esa empresa por ownership, y su fila ya está en el lote.
    const apolloKey = `${BATCH_ID}::${computeDiscardDispositionSourceKey({
      domain: 'conocida.com',
      name: 'Clínica Conocida',
    })}`;
    table.set(apolloKey, {
      batch_id: BATCH_ID,
      source_key: computeDiscardDispositionSourceKey({
        domain: 'conocida.com',
        name: 'Clínica Conocida',
      }),
      source_primary: 'apollo',
      disposition: 'ownership_domain_rejected',
      reason_code: 'company_ownership',
      evidence: { provider: 'apollo' },
    });

    const result = await persist([SEED_RECORD]);

    assert.equal(result.persisted, 0);
    assert.equal(result.conflicts, 1);
    const stored = table.get(apolloKey);
    assert.equal(stored?.source_primary, 'apollo', '🔴 la pierna anterior sigue siendo la autora');
    assert.equal(
      stored?.disposition,
      'ownership_domain_rejected',
      '🔴 el POR QUÉ de Apollo no se puede perder: no es un `sellup_duplicate`',
    );
  });

  it('una empresa DISTINTA de la de Apollo sí entra: la clave discrimina', async () => {
    table.set(
      `${BATCH_ID}::${computeDiscardDispositionSourceKey({ domain: 'otra.com', name: 'Otra' })}`,
      { batch_id: BATCH_ID, source_primary: 'apollo', disposition: 'country_rejected' },
    );
    const result = await persist([SEED_RECORD]);
    assert.equal(result.persisted, 1);
    assert.equal(result.conflicts, 0);
    assert.equal(table.size, 2);
  });
});

/**
 * AGENT1-CUT3B23 · CUT-3B3 — siembra del registro de identidad de lote.
 *
 * Fija que la siembra: lee SÓLO el lote indicado, SÓLO los estados que lo ocupan,
 * recupera las señales de las filas ya persistidas (incluido el LinkedIn desde la
 * metadata, y la identidad nativa del proveedor desde `source_trace`), y degrada
 * ADMITIENDO — nunca suprimiendo — cuando la lectura falla.
 *
 * Cliente Supabase falso: sin red, sin base de datos, sin credenciales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadBatchIdentityRegistry,
  providerEntityKeyForSeedRow,
  toRegisteredBatchIdentity,
  type BatchIdentitySeedRow,
} from '../batch-identity-registry-store';
import {
  BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES,
  evaluateCandidateIdentity,
} from '@/server/agents/prospecting-toolkit/batch-identity-registry';
import { buildCompanyIdentityEvidence } from '@/server/agents/prospecting-toolkit/company-identity-evidence';
import { preM126Rpc } from './support/lusha-pre-m126-fenced-insert';

// ─── Cliente falso ────────────────────────────────────────────────────────────

type Capture = {
  table: string | null;
  columns: string | null;
  batchId: string | null;
  statuses: string[] | null;
};

function fakeClient(
  rows: BatchIdentitySeedRow[] | null,
  options: { error?: boolean; throws?: boolean } = {},
): { client: SupabaseClient; capture: Capture } {
  const capture: Capture = { table: null, columns: null, batchId: null, statuses: null };
  const builder = {
    select(columns: string) {
      capture.columns = columns;
      return builder;
    },
    eq(_column: string, value: string) {
      capture.batchId = value;
      return builder;
    },
    in(_column: string, values: string[]) {
      capture.statuses = values;
      if (options.throws) throw new Error('boom');
      return Promise.resolve(
        options.error
          ? { data: null, error: { message: 'query failed' } }
          : { data: rows, error: null },
      );
    },
  };
  const client = {
    // CUT-3B4-CORRECCIÓN — el doble declara la 126 SIN aplicar como lo hace la
    // base: respondiendo que la función no existe. Omitir `rpc` modelaría un
    // cliente no soportado, que degrada CERRADO y no ejercita esta ruta.
    rpc: preM126Rpc,
    from(table: string) {
      capture.table = table;
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, capture };
}

function row(overrides: Partial<BatchIdentitySeedRow> = {}): BatchIdentitySeedRow {
  return {
    id: 'row-1',
    name: 'Acme S.A.S.',
    domain: null,
    website: null,
    country_code: 'CO',
    tax_id: '900123456',
    tax_identifier: '900123456',
    status: 'needs_review',
    metadata: null,
    source_trace: null,
    ...overrides,
  };
}

// ─── Ámbito de la consulta ────────────────────────────────────────────────────

describe('CUT-3B3 — la siembra lee UN lote y sólo los estados que lo ocupan', () => {
  it('consulta `prospect_candidates` filtrando por batch_id y por los cinco estados', async () => {
    const { client, capture } = fakeClient([row()]);
    const outcome = await loadBatchIdentityRegistry(client, 'batch-A');

    assert.equal(capture.table, 'prospect_candidates');
    assert.equal(capture.batchId, 'batch-A');
    assert.deepEqual(capture.statuses, [...BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES]);
    assert.equal(outcome.seededCount, 1);
    assert.equal(outcome.degraded, false);
    assert.equal(outcome.registry.batchId, 'batch-A');
  });

  it('🔴 no pide `linkedin_url` en el select: una columna opcional no puede tumbar la siembra', async () => {
    const { client, capture } = fakeClient([row()]);
    await loadBatchIdentityRegistry(client, 'batch-A');
    assert.equal(capture.columns?.includes('linkedin_url'), false);
    assert.equal(capture.columns?.includes('metadata'), true);
  });

  it('un lote inexistente no consulta nada y devuelve registro vacío', async () => {
    const { client, capture } = fakeClient([row()]);
    const outcome = await loadBatchIdentityRegistry(client, null);
    assert.equal(capture.table, null);
    assert.equal(outcome.seededCount, 0);
    assert.equal(outcome.registry.entries.length, 0);
  });
});

// ─── Degradación: ADMITE, nunca suprime ───────────────────────────────────────

describe('CUT-3B3 — la siembra degrada admitiendo', () => {
  it('un error de consulta deja la siembra vacía y lo declara', async () => {
    const { client } = fakeClient(null, { error: true });
    const outcome = await loadBatchIdentityRegistry(client, 'batch-A');
    assert.equal(outcome.degraded, true);
    assert.equal(outcome.seededCount, 0);
    assert.equal(outcome.registry.entries.length, 0);
  });

  it('una excepción del cliente no se propaga', async () => {
    const { client } = fakeClient(null, { throws: true });
    const outcome = await loadBatchIdentityRegistry(client, 'batch-A');
    assert.equal(outcome.degraded, true);
  });

  it('con siembra vacía el candidato se ADMITE: nunca «ya existía» por una consulta caída', async () => {
    const { client } = fakeClient(null, { error: true });
    const outcome = await loadBatchIdentityRegistry(client, 'batch-A');
    const decision = evaluateCandidateIdentity(
      outcome.registry,
      buildCompanyIdentityEvidence({ countryCode: 'CO', taxIdentifier: '900123456' }),
    );
    assert.equal(decision.action, 'accepted_unique');
  });
});

// ─── Señales recuperadas de una fila persistida ───────────────────────────────

describe('CUT-3B3 — señales de una fila ya persistida', () => {
  it('recupera la identidad fiscal por compatibilidad de columnas', () => {
    const seeded = toRegisteredBatchIdentity(
      row({ tax_id: null, tax_identifier: 'NIT 900.123.456-7' }),
    );
    assert.equal(seeded.evidence.fiscalIdentityKey, 'CO:900123456');
    assert.equal(seeded.candidateId, 'row-1');
  });

  it('dos columnas fiscales contradictorias fallan cerrado en la fila persistida', () => {
    const seeded = toRegisteredBatchIdentity(
      row({ tax_id: '900123456', tax_identifier: '800987654' }),
    );
    assert.equal(seeded.evidence.fiscalIdentityKey, null);
  });

  it('recupera el LinkedIn de la ruta canónica de metadata', () => {
    const seeded = toRegisteredBatchIdentity(
      row({
        metadata: {
          linkedin_enrichment: { company_url: 'https://linkedin.com/company/acme' },
        },
      }),
    );
    assert.equal(seeded.evidence.normalizedLinkedInCompany, 'linkedin.com/company/acme');
  });

  it('recupera el LinkedIn de la ruta plana histórica', () => {
    const seeded = toRegisteredBatchIdentity(
      row({ metadata: { linkedin_url: 'https://www.linkedin.com/company/acme/' } }),
    );
    assert.equal(seeded.evidence.normalizedLinkedInCompany, 'linkedin.com/company/acme');
  });

  it('un perfil PERSONAL en metadata no se convierte en identidad de empresa', () => {
    const seeded = toRegisteredBatchIdentity(
      row({ metadata: { linkedin_url: 'https://www.linkedin.com/in/juan' } }),
    );
    assert.equal(seeded.evidence.normalizedLinkedInCompany, null);
  });

  it('recupera la identidad nativa del proveedor CON su namespace', () => {
    const seedRow = row({
      source_trace: { sourceProvider: 'lusha', providerCompanyId: '99' },
    });
    assert.equal(providerEntityKeyForSeedRow(seedRow), 'lusha:99');
    assert.equal(toRegisteredBatchIdentity(seedRow).evidence.providerEntityKey, 'lusha:99');
  });

  it('sin id de empresa del proveedor NO se fabrica clave alguna', () => {
    const seedRow = row({ source_trace: { sourceProvider: 'co_siis' } });
    assert.equal(providerEntityKeyForSeedRow(seedRow), null);
    assert.equal(toRegisteredBatchIdentity(seedRow).evidence.providerEntityKey, null);
  });

  it('metadata o source_trace no-objeto no rompen la lectura', () => {
    const seeded = toRegisteredBatchIdentity(
      row({
        metadata: ['no', 'es', 'objeto'] as unknown as Record<string, unknown>,
        source_trace: 'tampoco' as unknown as Record<string, unknown>,
      }),
    );
    assert.equal(seeded.evidence.normalizedLinkedInCompany, null);
    assert.equal(seeded.evidence.providerEntityKey, null);
  });
});

// ─── La siembra hace VISIBLE lo que la otra capa escribió ──────────────────────

describe('CUT-3B3 — una capa ve lo que la otra ya persistió en el lote', () => {
  it('una fila GRATUITA sembrada hace que el candidato de PAGO con la misma identidad fiscal salte', async () => {
    const { client } = fakeClient([
      row({ id: 'free-row', tax_id: '900123456', tax_identifier: '900123456', domain: null }),
    ]);
    const outcome = await loadBatchIdentityRegistry(client, 'batch-A');

    const paid = buildCompanyIdentityEvidence({
      countryCode: 'CO',
      taxIdentifier: '900.123.456-7',
      domain: 'acme.com',
      name: 'Acme',
    });
    const decision = evaluateCandidateIdentity(outcome.registry, paid);

    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'fiscal_identity');
    assert.deepEqual([...decision.matchedCandidateIds], ['free-row']);
  });

  it('una fila de PAGO sembrada con dominio hace saltar al candidato con el mismo dominio', async () => {
    const { client } = fakeClient([
      row({ id: 'paid-row', tax_id: null, tax_identifier: null, domain: 'acme.com' }),
    ]);
    const outcome = await loadBatchIdentityRegistry(client, 'batch-A');
    const decision = evaluateCandidateIdentity(
      outcome.registry,
      buildCompanyIdentityEvidence({ countryCode: 'CO', domain: 'www.acme.com', name: 'Acme' }),
    );
    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'normalized_domain');
  });
});

// ─── § 5 — el nombre de una fila SEMBRADA también es evidencia ────────────────

describe('CUT-3B23 REVIEW-FIX § 5 — nombre canónico de la fila persistida', () => {
  it('🔴 una fila sembrada conserva su nombre canónico como evidencia', () => {
    // `SEED_COLUMNS` ya leía `name`, pero no llegaba al constructor: la fila
    // persistida entraba al registro MUDA de nombre.
    const registered = toRegisteredBatchIdentity(row({ name: 'Servicios Integrales S.A.S.' }));
    assert.equal(registered.evidence.canonicalName !== null, true);
  });

  it('un nombre ausente sigue siendo `null`, nunca una cadena vacía', () => {
    const registered = toRegisteredBatchIdentity(row({ name: null }));
    assert.equal(registered.evidence.canonicalName, null);
  });

  it('🔴 el nombre sigue siendo evidencia DÉBIL: coincidir sólo por nombre NO suprime', async () => {
    // Fila persistida SIN identidad fiscal ni dominio: sólo nombre.
    const { client } = fakeClient([
      row({ id: 'seeded-1', name: 'Servicios Integrales S.A.S.', tax_id: null, tax_identifier: null }),
    ]);
    const outcome = await loadBatchIdentityRegistry(client, 'batch-A');
    assert.equal(outcome.seededCount, 1);

    const decision = evaluateCandidateIdentity(
      outcome.registry,
      buildCompanyIdentityEvidence({ countryCode: 'CO', name: 'SERVICIOS INTEGRALES SAS' }),
    );

    assert.equal(decision.action, 'possible_duplicate');
    assert.notEqual(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'canonical_name');
    assert.equal(decision.matchedTier, 5);
    assert.equal(decision.softReason, 'name_only');
  });
});

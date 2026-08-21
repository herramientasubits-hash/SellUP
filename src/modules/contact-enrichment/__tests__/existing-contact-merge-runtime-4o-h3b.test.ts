/**
 * Agente 2A — la ORQUESTACIÓN del merge humano, con dependencias inyectadas
 * (AGENT2A-PHONE-REVEAL-4O-H3-B).
 *
 * Lo que se demuestra aquí es lo que ocurre ANTES de que se abra transacción alguna: qué
 * peticiones ni siquiera llegan a la 117, y qué peticiones llegan con exactamente qué
 * argumentos. Es la mitad del contrato que PostgreSQL no puede fijar, porque una petición que la
 * base rechaza correctamente sigue siendo una petición que nunca debió salir del servidor.
 *
 * En particular:
 *   * la APROBACIÓN por sí sola NUNCA fusiona — sólo ofrece;
 *   * una identidad ambigua o por nombre no abre transacción;
 *   * un `contactId` arbitrario no abre transacción;
 *   * el patch que viaja repite el veredicto `duplicate` y nunca lo convierte en aprobación.
 *
 * Sin red, sin DB, sin reloj.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApproveCandidate,
  runMergeCandidateIntoExistingContact,
  type CandidateRecord,
  type ExistingContactForDedup,
  type MergeAuditEntry,
  type MergeIntoExistingContactDeps,
  type MergeTransactionInput,
} from '../candidate-review-core';

const CANDIDATE_ID = '33333333-3333-4333-8333-333333333333';
const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '55555555-5555-4555-8555-555555555555';
const ACTOR_ID = '66666666-6666-4666-8666-666666666666';
const NOW = '2026-08-12T12:00:00.000Z';

function candidateRecord(over: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id: CANDIDATE_ID,
    status: 'duplicate',
    full_name: 'Ana Perez',
    first_name: 'Ana',
    last_name: 'Perez',
    title: null,
    seniority: null,
    department: null,
    email: 'ana@acme.com',
    phone: null,
    linkedin_url: null,
    source: 'apollo',
    enrichment_metadata: {},
    enrichment_run_id: null,
    account_id: ACCOUNT_ID,
    hubspot_company_id: null,
    company_name: null,
    company_domain: null,
    country_code: null,
    matched_contacts_id: CONTACT_ID,
    ...over,
  };
}

const TRUSTED_CONTACTS: ExistingContactForDedup[] = [
  { id: CONTACT_ID, email: 'ana@acme.com', linkedin_url: null, full_name: 'Ana Perez' },
];

interface Recorder {
  merges: MergeTransactionInput[];
  audits: MergeAuditEntry[];
}

function deps(
  over: Partial<MergeIntoExistingContactDeps> & { candidate?: CandidateRecord } = {},
): { deps: MergeIntoExistingContactDeps; recorder: Recorder } {
  const recorder: Recorder = { merges: [], audits: [] };
  const candidate = over.candidate ?? candidateRecord();
  const base: MergeIntoExistingContactDeps = {
    actorId: ACTOR_ID,
    nowIso: NOW,
    loadCandidate: async () => candidate,
    loadExistingContacts: async () => TRUSTED_CONTACTS,
    loadExistingContactScalar: async (id) => ({
      id,
      phone: null,
      phone_type: null,
      phone_source: null,
      phone_raw_type: null,
    }),
    mergeTransactionally: async (input) => {
      recorder.merges.push(input);
      return {
        ok: true,
        contactId: input.contactId,
        alreadyMerged: false,
        phonesInserted: 2,
        sourcesInserted: 3,
      };
    },
    logAudit: async (entry) => {
      recorder.audits.push(entry);
    },
  };
  return { deps: { ...base, ...over }, recorder };
}

// ═══════════════════════════════════════════════════════════════
// 1. Aprobar NUNCA fusiona
// ═══════════════════════════════════════════════════════════════

describe('4O-H3-B — la aprobación ofrece, no fusiona', () => {
  async function approveAgainst(existing: ExistingContactForDedup[], candidate?: Partial<CandidateRecord>) {
    let transactions = 0;
    const result = await runApproveCandidate(CANDIDATE_ID, {
      actorId: ACTOR_ID,
      nowIso: NOW,
      loadCandidate: async () => candidateRecord({ status: 'pending_review', ...candidate }),
      loadExistingContacts: async () => existing,
      approveTransactionally: async () => {
        transactions += 1;
        return { ok: true, contactId: CONTACT_ID, alreadyApproved: false };
      },
      updateCandidate: async () => ({}),
    });
    return { result, transactions };
  }

  it('un duplicado exacto NO crea contacto y devuelve la oferta', () => {
    return approveAgainst(TRUSTED_CONTACTS).then(({ result, transactions }) => {
      assert.equal(result.ok, false);
      assert.equal(transactions, 0, 'la aprobación no abre transacción para un duplicado');
      assert.ok(!result.ok && result.duplicate);
      assert.deepEqual(!result.ok && result.mergeOffer, {
        offered: true,
        contactId: CONTACT_ID,
        signal: 'email',
      });
    });
  });

  it('un duplicado por NOMBRE no ofrece nada — y el veredicto no cambia', () => {
    return approveAgainst(
      [{ id: CONTACT_ID, email: null, linkedin_url: null, full_name: 'Ana Perez' }],
      { email: null, linkedin_url: null },
    ).then(({ result }) => {
      assert.ok(!result.ok && result.duplicate, 'sigue siendo un duplicado, como siempre');
      assert.deepEqual(!result.ok && result.mergeOffer, { offered: false, reason: 'name_only' });
    });
  });

  it('un email compartido por dos contactos no ofrece nada', () => {
    return approveAgainst([
      { id: CONTACT_ID, email: 'ana@acme.com', linkedin_url: null, full_name: 'Ana Perez' },
      { id: OTHER_CONTACT_ID, email: 'ana@acme.com', linkedin_url: null, full_name: 'Ana P.' },
    ]).then(({ result }) => {
      assert.deepEqual(!result.ok && result.mergeOffer, {
        offered: false,
        reason: 'multiple_contacts',
      });
    });
  });

  it('una aprobación LIMPIA sigue creando el contacto y no menciona ninguna oferta', () => {
    return approveAgainst([]).then(({ result, transactions }) => {
      assert.equal(result.ok, true);
      assert.equal(transactions, 1);
      assert.equal('mergeOffer' in result, false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Lo que no llega a la transacción
// ═══════════════════════════════════════════════════════════════

describe('4O-H3-B — peticiones que no abren transacción', () => {
  it('rechaza un candidato que NO está en `duplicate`', async () => {
    for (const status of ['pending_review', 'approved', 'discarded'] as const) {
      const { deps: d, recorder } = deps({ candidate: candidateRecord({ status }) });
      const out = await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d);
      assert.equal(out.ok, false);
      assert.equal(!out.ok && out.code, 'CANDIDATE_NOT_MERGEABLE', status);
      assert.equal(recorder.merges.length, 0);
    }
  });

  it('rechaza un `contactId` ARBITRARIO aunque la identidad sea confiable — IDOR', async () => {
    const { deps: d, recorder } = deps();
    const out = await runMergeCandidateIntoExistingContact(
      CANDIDATE_ID,
      '99999999-9999-4999-8999-999999999999',
      d,
    );
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.code, 'CONTACT_MISMATCH');
    assert.equal(recorder.merges.length, 0, 'un uuid forjado no puede abrir transacción');
  });

  it('rechaza cuando `matched_contacts_id` apunta a otro contacto', async () => {
    const { deps: d, recorder } = deps({
      candidate: candidateRecord({ matched_contacts_id: OTHER_CONTACT_ID }),
    });
    const out = await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d);
    assert.equal(!out.ok && out.code, 'MERGE_NOT_TRUSTED');
    assert.equal(recorder.merges.length, 0);
  });

  it('rechaza una identidad AMBIGUA', async () => {
    const { deps: d, recorder } = deps({
      loadExistingContacts: async () => [
        { id: CONTACT_ID, email: 'ana@acme.com', linkedin_url: null, full_name: 'Ana' },
        { id: OTHER_CONTACT_ID, email: 'ana@acme.com', linkedin_url: null, full_name: 'Ana' },
      ],
    });
    const out = await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d);
    assert.equal(!out.ok && out.code, 'MERGE_NOT_TRUSTED');
    assert.equal(recorder.merges.length, 0);
  });

  it('rechaza una coincidencia SOLO por nombre', async () => {
    const { deps: d, recorder } = deps({
      candidate: candidateRecord({ email: null, linkedin_url: null }),
      loadExistingContacts: async () => [
        { id: CONTACT_ID, email: null, linkedin_url: null, full_name: 'Ana Perez' },
      ],
    });
    const out = await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d);
    assert.equal(!out.ok && out.code, 'MERGE_NOT_TRUSTED');
    assert.equal(recorder.merges.length, 0);
  });

  it('rechaza un candidato inexistente y una petición vacía', async () => {
    const { deps: d } = deps({ loadCandidate: async () => null });
    assert.equal(
      (await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d)).ok,
      false,
    );
    const { deps: d2, recorder } = deps();
    for (const [cid, ctid] of [
      ['', CONTACT_ID],
      [CANDIDATE_ID, '   '],
    ] as const) {
      const out = await runMergeCandidateIntoExistingContact(cid, ctid, d2);
      assert.equal(!out.ok && out.code, 'INVALID_INPUT');
    }
    assert.equal(recorder.merges.length, 0);
  });

  it('rechaza cuando el contacto destino ya no está disponible', async () => {
    const { deps: d, recorder } = deps({ loadExistingContactScalar: async () => null });
    const out = await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d);
    assert.equal(!out.ok && out.code, 'CONTACT_MISMATCH');
    assert.equal(recorder.merges.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Lo que sí llega, y con qué
// ═══════════════════════════════════════════════════════════════

describe('4O-H3-B — lo que viaja a la transacción', () => {
  it('fusiona y devuelve el contacto existente, sin crear ninguno', async () => {
    const { deps: d, recorder } = deps();
    const out = await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d);
    assert.equal(out.ok, true);
    assert.equal(out.ok && out.contactId, CONTACT_ID);
    assert.equal(recorder.merges.length, 1);
  });

  it('el patch REPITE el veredicto duplicado y nunca lo convierte en aprobación', async () => {
    const { deps: d, recorder } = deps();
    await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d);
    const patch = recorder.merges[0].reviewPatch;
    assert.equal(patch.status, 'duplicate');
    assert.equal(patch.duplicate_status, 'exact_duplicate');
    assert.equal(patch.reviewed_by, ACTOR_ID);
  });

  it('la señal exacta viaja en la metadata de revisión — nunca `name`', async () => {
    const { deps: d, recorder } = deps();
    await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d);
    const review = (recorder.merges[0].reviewPatch.enrichment_metadata as Record<string, unknown>)
      .review as Record<string, unknown>;
    assert.equal(review.merged_match_signal, 'email');
    assert.equal(review.matched_contact_id, CONTACT_ID);
  });

  it('conserva la metadata previa del candidato al mezclar la revisión', async () => {
    const { deps: d, recorder } = deps({
      candidate: candidateRecord({ enrichment_metadata: { relevance: 0.9, phone: { source: 'x' } } }),
    });
    await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d);
    const meta = recorder.merges[0].reviewPatch.enrichment_metadata as Record<string, unknown>;
    assert.equal(meta.relevance, 0.9);
    assert.ok(meta.phone, 'no se pierde el bloque phone al escribir la revisión');
  });

  it('el escalar heredado del contacto viaja tal y como se leyó', async () => {
    const { deps: d, recorder } = deps({
      loadExistingContactScalar: async (id) => ({
        id,
        phone: '+15550000009',
        phone_type: 'work',
        phone_source: 'manual',
        phone_raw_type: 'work',
      }),
    });
    await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d);
    assert.deepEqual(recorder.merges[0].incumbentScalar, {
      id: CONTACT_ID,
      phone: '+15550000009',
      phone_type: 'work',
      phone_source: 'manual',
      phone_raw_type: 'work',
    });
  });

  it('audita SIN PII y sólo cuando la transacción escribió algo', async () => {
    const { deps: d, recorder } = deps();
    await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d);
    assert.equal(recorder.audits.length, 1);
    assert.deepEqual(recorder.audits[0], {
      contactId: CONTACT_ID,
      accountId: ACCOUNT_ID,
      candidateId: CANDIDATE_ID,
      actorUserId: ACTOR_ID,
      matchSignal: 'email',
      phonesInserted: 2,
      sourcesInserted: 3,
    });
    const serialized = JSON.stringify(recorder.audits[0]);
    for (const pii of ['Ana', 'ana@acme.com', '+1555']) {
      assert.equal(serialized.includes(pii), false, `${pii} no puede viajar al audit`);
    }
  });

  it('un merge YA hecho no se vuelve a auditar y no es un fallo', async () => {
    const { deps: d, recorder } = deps({
      mergeTransactionally: async (input) => ({
        ok: true,
        contactId: input.contactId,
        alreadyMerged: true,
        phonesInserted: 0,
        sourcesInserted: 0,
      }),
    });
    const out = await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d);
    assert.equal(out.ok, true);
    assert.equal(out.ok && out.alreadyMerged, true);
    assert.equal(recorder.audits.length, 0, 'no se creó nada: no hay nada que auditar');
  });

  it('un fallo de la transacción no se reporta como éxito ni audita', async () => {
    const { deps: d, recorder } = deps({
      mergeTransactionally: async () => ({ ok: false, error: 'boom' }),
    });
    const out = await runMergeCandidateIntoExistingContact(CANDIDATE_ID, CONTACT_ID, d);
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.code, 'MERGE_FAILED');
    assert.equal(recorder.audits.length, 0);
  });
});

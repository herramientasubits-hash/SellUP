/**
 * Tests — Candidate Review Core (Agente 2A, Hito 17A.4B)
 *
 * Verifica la lógica pura (dedup, mapeo, metadata) y la orquestación de
 * aprobar/rechazar mediante dependencias inyectadas (sin DB, sin auth).
 * NO se ejecuta Apollo ni HubSpot: el core no los importa y los tests confirman
 * que las únicas mutaciones son insertContact + updateCandidate.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  findDuplicateContact,
  mapCandidateSource,
  mapCandidateSeniority,
  parseContactName,
  buildContactInsertPayload,
  buildContactTraceMetadata,
  runApproveCandidate,
  runDiscardCandidate,
  type CandidateRecord,
  type ExistingContactForDedup,
  type ApproveDeps,
  type DiscardDeps,
  type CandidateReviewPatch,
  type ContactInsertPayload,
} from '../candidate-review-core';

// ── Fixtures ────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id: 'cand-1',
    status: 'pending_review',
    full_name: 'Ana López',
    first_name: 'Ana',
    last_name: 'López',
    title: 'HR Manager',
    seniority: 'manager',
    department: 'human resources',
    email: 'ana@corp.com',
    phone: '+57 300 000 0000',
    linkedin_url: 'https://linkedin.com/in/analopez',
    source: 'apollo',
    enrichment_metadata: { relevance: { status: 'high_relevance', score: 0.9 } },
    enrichment_run_id: 'run-1',
    account_id: 'acc-1',
    ...overrides,
  };
}

function makeApproveDeps(overrides: Partial<ApproveDeps> = {}): {
  deps: ApproveDeps;
  calls: {
    inserted: ContactInsertPayload[];
    updated: { id: string; patch: CandidateReviewPatch }[];
    audited: number;
  };
} {
  const calls = {
    inserted: [] as ContactInsertPayload[],
    updated: [] as { id: string; patch: CandidateReviewPatch }[],
    audited: 0,
  };
  const deps: ApproveDeps = {
    actorId: 'user-1',
    nowIso: '2026-06-29T12:00:00.000Z',
    loadCandidate: async () => makeCandidate(),
    loadExistingContacts: async () => [],
    insertContact: async (payload) => {
      calls.inserted.push(payload);
      return { id: 'contact-new' };
    },
    updateCandidate: async (id, patch) => {
      calls.updated.push({ id, patch });
      return {};
    },
    logAudit: async () => {
      calls.audited += 1;
    },
    ...overrides,
  };
  return { deps, calls };
}

// ── Helpers puros ───────────────────────────────────────────────

describe('mapCandidateSource', () => {
  it('mapea fuentes 1:1 y mock → other', () => {
    assert.equal(mapCandidateSource('apollo'), 'apollo');
    assert.equal(mapCandidateSource('lusha'), 'lusha');
    assert.equal(mapCandidateSource('hubspot'), 'hubspot');
    assert.equal(mapCandidateSource('manual'), 'manual');
    assert.equal(mapCandidateSource('mock'), 'other');
  });
});

describe('mapCandidateSeniority', () => {
  it('mapea al enum CHECK de contacts o null', () => {
    assert.equal(mapCandidateSeniority('owner'), 'c_level');
    assert.equal(mapCandidateSeniority('executive'), 'c_level');
    assert.equal(mapCandidateSeniority('vp'), 'vp');
    assert.equal(mapCandidateSeniority('director'), 'director');
    assert.equal(mapCandidateSeniority('manager'), 'manager');
    assert.equal(mapCandidateSeniority('employee'), 'individual_contributor');
    assert.equal(mapCandidateSeniority('partner'), null); // fuera del enum → null
    assert.equal(mapCandidateSeniority(null), null);
  });
});

describe('findDuplicateContact', () => {
  const existing: ExistingContactForDedup[] = [
    {
      id: 'c-email',
      email: 'ANA@corp.com',
      linkedin_url: null,
      full_name: 'Otra Persona',
    },
    {
      id: 'c-linkedin',
      email: null,
      linkedin_url: 'https://linkedin.com/in/luis/',
      full_name: 'Otro Nombre',
    },
    { id: 'c-name', email: null, linkedin_url: null, full_name: 'José Pérez' },
  ];

  it('detecta duplicado por email (case-insensitive)', () => {
    const m = findDuplicateContact(
      { email: 'ana@corp.com', linkedin_url: null, full_name: 'X' },
      existing,
    );
    assert.deepEqual(m, { contactId: 'c-email', matchedBy: 'email' });
  });

  it('detecta duplicado por linkedin (normaliza barra final)', () => {
    const m = findDuplicateContact(
      { email: null, linkedin_url: 'https://linkedin.com/in/luis', full_name: 'X' },
      existing,
    );
    assert.deepEqual(m, { contactId: 'c-linkedin', matchedBy: 'linkedin' });
  });

  it('usa nombre como fallback solo si no hay email ni linkedin', () => {
    const m = findDuplicateContact(
      { email: null, linkedin_url: null, full_name: 'jose perez' },
      existing,
    );
    assert.deepEqual(m, { contactId: 'c-name', matchedBy: 'name' });
  });

  it('NO usa nombre si el candidato tiene email sin match', () => {
    const m = findDuplicateContact(
      { email: 'nuevo@corp.com', linkedin_url: null, full_name: 'José Pérez' },
      existing,
    );
    assert.equal(m, null);
  });

  it('devuelve null cuando no hay coincidencias', () => {
    const m = findDuplicateContact(
      { email: 'x@y.com', linkedin_url: null, full_name: 'Nadie' },
      existing,
    );
    assert.equal(m, null);
  });
});

describe('buildContactInsertPayload', () => {
  it('mapea title→job_title, source y metadata de origen', () => {
    const payload = buildContactInsertPayload({
      candidate: makeCandidate({ source: 'mock', seniority: 'owner' }),
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    assert.equal(payload.account_id, 'acc-1');
    assert.equal(payload.full_name, 'Ana López');
    assert.equal(payload.job_title, 'HR Manager');
    assert.equal(payload.email, 'ana@corp.com');
    assert.equal(payload.source, 'other'); // mock → other
    assert.equal(payload.seniority, 'c_level'); // owner → c_level
    assert.equal(payload.contact_status, 'active');
    assert.equal(payload.created_by, 'user-1');
    assert.equal(payload.metadata.source, 'contact_enrichment_candidate');
    assert.equal(payload.metadata.source_candidate_id, 'cand-1');
  });

  it('descarta email inválido a null sin romper', () => {
    const payload = buildContactInsertPayload({
      candidate: makeCandidate({ email: 'no-es-email' }),
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    assert.equal(payload.email, null);
  });
});

describe('buildContactTraceMetadata', () => {
  it('preserva relevance y no incluye payload crudo', () => {
    const meta = buildContactTraceMetadata(makeCandidate());
    assert.equal(meta.source, 'contact_enrichment_candidate');
    assert.deepEqual(meta.relevance, { status: 'high_relevance', score: 0.9 });
  });
});

// ── Aprobar ─────────────────────────────────────────────────────

describe('runApproveCandidate', () => {
  it('crea contacto y marca candidato approved con created_contact_id', async () => {
    const { deps, calls } = makeApproveDeps();
    const result = await runApproveCandidate('cand-1', deps);

    assert.equal(result.ok, true);
    assert.equal(calls.inserted.length, 1); // contacto creado
    assert.equal(calls.updated.length, 1);
    const patch = calls.updated[0].patch;
    assert.equal(patch.status, 'approved');
    assert.equal(patch.matched_contacts_id, 'contact-new');
    const review = (patch.enrichment_metadata as { review: Record<string, unknown> }).review;
    assert.equal(review.status, 'approved');
    assert.equal(review.created_contact_id, 'contact-new');
    assert.equal(review.reviewed_by, 'user-1');
    assert.equal(calls.audited, 1);
    if (result.ok) assert.equal(result.contactId, 'contact-new');
  });

  it('falla si el candidato no existe', async () => {
    const { deps, calls } = makeApproveDeps({ loadCandidate: async () => null });
    const result = await runApproveCandidate('cand-x', deps);
    assert.equal(result.ok, false);
    assert.equal(calls.inserted.length, 0);
  });

  it('falla si el candidato no está pending_review', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () => makeCandidate({ status: 'approved' }),
    });
    const result = await runApproveCandidate('cand-1', deps);
    assert.equal(result.ok, false);
    assert.equal(calls.inserted.length, 0);
  });

  it('bloquea si no hay account_id', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () => makeCandidate({ account_id: null }),
    });
    const result = await runApproveCandidate('cand-1', deps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /cuenta SellUp/);
    assert.equal(calls.inserted.length, 0);
  });

  it('marca duplicate (no crea contacto) si ya existe por email', async () => {
    const { deps, calls } = makeApproveDeps({
      loadExistingContacts: async () => [
        { id: 'dup-1', email: 'ana@corp.com', linkedin_url: null, full_name: 'Ana López' },
      ],
    });
    const result = await runApproveCandidate('cand-1', deps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.duplicate, true);
    assert.equal(calls.inserted.length, 0); // NO crea contacto
    assert.equal(calls.updated[0].patch.status, 'duplicate');
    assert.equal(calls.updated[0].patch.matched_contacts_id, 'dup-1');
    assert.equal(calls.updated[0].patch.duplicate_status, 'exact_duplicate');
  });

  it('marca duplicate si ya existe por linkedin', async () => {
    const { deps, calls } = makeApproveDeps({
      loadCandidate: async () => makeCandidate({ email: null }),
      loadExistingContacts: async () => [
        {
          id: 'dup-2',
          email: null,
          linkedin_url: 'https://linkedin.com/in/analopez',
          full_name: 'X',
        },
      ],
    });
    const result = await runApproveCandidate('cand-1', deps);
    assert.equal(result.ok, false);
    assert.equal(calls.inserted.length, 0);
    assert.equal(calls.updated[0].patch.matched_contacts_id, 'dup-2');
  });

  it('reporta error suave si falla la inserción del contacto', async () => {
    const { deps, calls } = makeApproveDeps({
      insertContact: async () => ({ error: 'insert boom' }),
    });
    const result = await runApproveCandidate('cand-1', deps);
    assert.equal(result.ok, false);
    assert.equal(calls.updated.length, 0); // no se marca approved si no se creó
  });
});

// ── Rechazar ────────────────────────────────────────────────────

describe('runDiscardCandidate', () => {
  function makeDiscardDeps(overrides: Partial<DiscardDeps> = {}): {
    deps: DiscardDeps;
    updated: { id: string; patch: CandidateReviewPatch }[];
  } {
    const updated: { id: string; patch: CandidateReviewPatch }[] = [];
    const deps: DiscardDeps = {
      actorId: 'user-1',
      nowIso: '2026-06-29T12:00:00.000Z',
      loadCandidate: async () => makeCandidate(),
      updateCandidate: async (id, patch) => {
        updated.push({ id, patch });
        return {};
      },
      ...overrides,
    };
    return { deps, updated };
  }

  it('marca discarded y guarda el motivo en review_notes + metadata', async () => {
    const { deps, updated } = makeDiscardDeps();
    const result = await runDiscardCandidate('cand-1', 'Datos insuficientes', deps);
    assert.equal(result.ok, true);
    assert.equal(updated[0].patch.status, 'discarded');
    assert.equal(updated[0].patch.review_notes, 'Datos insuficientes');
    const review = (updated[0].patch.enrichment_metadata as { review: Record<string, unknown> })
      .review;
    assert.equal(review.status, 'discarded');
    assert.equal(review.reason, 'Datos insuficientes');
    assert.equal(review.reviewed_by, 'user-1');
  });

  it('usa "Otro" cuando el motivo viene vacío', async () => {
    const { deps, updated } = makeDiscardDeps();
    await runDiscardCandidate('cand-1', '   ', deps);
    assert.equal(updated[0].patch.review_notes, 'Otro');
  });

  it('falla si el candidato no existe', async () => {
    const { deps, updated } = makeDiscardDeps({ loadCandidate: async () => null });
    const result = await runDiscardCandidate('cand-x', 'X', deps);
    assert.equal(result.ok, false);
    assert.equal(updated.length, 0);
  });

  it('falla si el candidato no está pending_review', async () => {
    const { deps, updated } = makeDiscardDeps({
      loadCandidate: async () => makeCandidate({ status: 'discarded' }),
    });
    const result = await runDiscardCandidate('cand-1', 'X', deps);
    assert.equal(result.ok, false);
    assert.equal(updated.length, 0);
  });
});

// ── parseContactName (Hito 17A.5A) ─────────────────────────────

describe('parseContactName', () => {
  it('dos palabras: firstName + lastName', () => {
    const r = parseContactName('Valeria Gómez');
    assert.equal(r.firstName, 'Valeria');
    assert.equal(r.lastName, 'Gómez');
    assert.equal(r.normalizedFullName, 'Valeria Gómez');
  });

  it('cuatro palabras: firstName + resto como lastName', () => {
    const r = parseContactName('Juan Carlos Pérez Gómez');
    assert.equal(r.firstName, 'Juan');
    assert.equal(r.lastName, 'Carlos Pérez Gómez');
  });

  it('una sola palabra: firstName, lastName null', () => {
    const r = parseContactName('María');
    assert.equal(r.firstName, 'María');
    assert.equal(r.lastName, null);
  });

  it('colapsa espacios múltiples', () => {
    const r = parseContactName('  Ana   Torres  ');
    assert.equal(r.firstName, 'Ana');
    assert.equal(r.lastName, 'Torres');
    assert.equal(r.normalizedFullName, 'Ana Torres');
  });
});

// ── buildContactInsertPayload — normalización 17A.5A ───────────

describe('buildContactInsertPayload — normalización 17A.5A', () => {
  it('rellena first/last desde full_name cuando el candidato los tiene null', () => {
    const payload = buildContactInsertPayload({
      candidate: makeCandidate({ first_name: null, last_name: null, full_name: 'Valeria Gómez QA' }),
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    assert.equal(payload.first_name, 'Valeria');
    assert.equal(payload.last_name, 'Gómez QA');
    assert.equal(payload.full_name, 'Valeria Gómez QA');
  });

  it('normaliza email a lowercase', () => {
    const payload = buildContactInsertPayload({
      candidate: makeCandidate({ email: 'VALERIA@Corp.COM' }),
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    assert.equal(payload.email, 'valeria@corp.com');
  });

  it('email vacío queda null', () => {
    const payload = buildContactInsertPayload({
      candidate: makeCandidate({ email: '   ' }),
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    assert.equal(payload.email, null);
  });

  it('LinkedIn sin https:// obtiene prefijo', () => {
    const payload = buildContactInsertPayload({
      candidate: makeCandidate({ linkedin_url: 'linkedin.com/in/valeria' }),
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    assert.equal(payload.linkedin_url, 'https://linkedin.com/in/valeria');
  });

  it('LinkedIn null queda null', () => {
    const payload = buildContactInsertPayload({
      candidate: makeCandidate({ linkedin_url: null }),
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    assert.equal(payload.linkedin_url, null);
  });

  it('phone vacío queda null', () => {
    const payload = buildContactInsertPayload({
      candidate: makeCandidate({ phone: '   ' }),
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    assert.equal(payload.phone, null);
  });

  it('metadata.normalization existe con status normalized y campos', () => {
    const payload = buildContactInsertPayload({
      candidate: makeCandidate({ first_name: null, last_name: null, full_name: 'Valeria Gómez QA' }),
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    const norm = payload.metadata.normalization as { status: string; fields: string[] };
    assert.equal(norm.status, 'normalized');
    assert.ok(Array.isArray(norm.fields));
    assert.ok(norm.fields.includes('first_name'));
    assert.ok(norm.fields.includes('last_name'));
    assert.ok(norm.fields.includes('full_name'));
  });

  it('no modifica el status del candidato (sin side effects)', () => {
    const candidate = makeCandidate({ first_name: null, last_name: null });
    buildContactInsertPayload({ candidate, accountId: 'acc-1', internalUserId: 'user-1' });
    assert.equal(candidate.status, 'pending_review');
  });
});

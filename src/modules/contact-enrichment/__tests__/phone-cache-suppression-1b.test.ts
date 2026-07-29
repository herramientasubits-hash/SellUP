/**
 * Agente 2A — Apollo Phone Cache SUPPRESSION (APOLLO-PHONE-CACHE-1b)
 *
 * Pruebas offline del core puro de supresión. La supresión es la condición bajo
 * la que se aprobó la caché: un teléfono reutilizado tiene que poder borrarse de
 * verdad — en la caché, en los candidatos y en los contactos oficiales — dejando
 * un tombstone que bloquee reutilizaciones y reveals futuros.
 *
 * Sin red, sin Supabase, sin reloj real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPhoneCacheSuppressionAudit,
  buildPhoneCacheSuppressionPlan,
  stripPhoneFromEnrichmentMetadata,
  PHONE_CACHE_SUPPRESSION_AUTHORIZED_ROLE_KEYS,
  type SuppressibleCandidate,
  type SuppressibleContact,
} from '../phone-cache-suppression-core';
import { evaluatePhoneCacheLookup } from '../phone-cache-core';

const NOW = '2026-07-29T12:00:00.000Z';
const PERSON_ID = '6a6826ba804c600014ead739';
const LUSHA_ID = 'v1.abcdefghijklmnop';
const ACCOUNT_A = 'acct-aaaa-1111';
const ACCOUNT_B = 'acct-bbbb-2222';
/** Teléfono ficticio de prueba. Nunca un número real. */
const FAKE_PHONE = '+570000000000';

const ADMIN = { actorUserId: 'user-admin-1', actorRoleKey: 'admin' };

function candidates(): SuppressibleCandidate[] {
  return [
    {
      id: 'cand-1',
      accountId: ACCOUNT_A,
      enrichmentMetadata: {
        relevance: { score: 0.9 },
        phone: { number: FAKE_PHONE, type: 'mobile', source: 'apollo_cache' },
      } as never,
      matchedContactId: 'contact-1',
    },
    {
      id: 'cand-2',
      accountId: ACCOUNT_A,
      enrichmentMetadata: {
        phone: { number: FAKE_PHONE, type: 'mobile', source: 'apollo_reveal' },
      } as never,
      matchedContactId: null,
    },
  ];
}

function contacts(): SuppressibleContact[] {
  return [
    { id: 'contact-2', accountId: ACCOUNT_A, sourceCandidateId: 'cand-2' },
    // Cuenta distinta: NUNCA debe tocarse.
    { id: 'contact-9', accountId: ACCOUNT_B, sourceCandidateId: 'cand-2' },
  ];
}

function plan(
  inputOverrides: Partial<Parameters<typeof buildPhoneCacheSuppressionPlan>[0]> = {},
  contextOverrides: Partial<Parameters<typeof buildPhoneCacheSuppressionPlan>[1]> = {},
) {
  return buildPhoneCacheSuppressionPlan(
    {
      providerPersonId: PERSON_ID,
      accountId: ACCOUNT_A,
      countryCode: 'CO',
      reason: 'dsar_request',
      ...ADMIN,
      ...inputOverrides,
    },
    { nowIso: NOW, candidates: candidates(), contacts: contacts(), ...contextOverrides },
  );
}

// ── Gate de rol ────────────────────────────────────────────────

describe('CACHE-1b supresión — autorización', () => {
  it('solo admin puede suprimir (más estricto que el reveal)', () => {
    assert.deepEqual(PHONE_CACHE_SUPPRESSION_AUTHORIZED_ROLE_KEYS, ['admin']);
  });

  it('commercial_manager NO puede suprimir aunque sí pueda revelar', () => {
    const result = plan({ actorRoleKey: 'commercial_manager' });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.rejection, 'unauthorized_role');
  });

  it('sin rol se rechaza (fail-closed) y no se produce plan alguno', () => {
    const result = plan({ actorRoleKey: null });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.rejection, 'unauthorized_role');
  });
});

// ── Validación de entrada ──────────────────────────────────────

describe('CACHE-1b supresión — validación fail-closed', () => {
  it('un id Lusha `v1.*` se rechaza', () => {
    const result = plan({ providerPersonId: LUSHA_ID });
    assert.equal(result.ok === false && result.rejection, 'invalid_person_id');
  });

  it('sin cuenta se rechaza (la supresión es siempre scoped por cuenta)', () => {
    const result = plan({ accountId: '' });
    assert.equal(result.ok === false && result.rejection, 'missing_account');
  });

  it('sin motivo se rechaza (el tombstone siempre es auditable)', () => {
    const result = plan({ reason: '   ' });
    assert.equal(result.ok === false && result.rejection, 'missing_reason');
  });
});

// ── Hard delete + tombstone ────────────────────────────────────

describe('CACHE-1b supresión — hard delete en los tres lugares', () => {
  it('la caché queda con tombstone y SIN teléfono', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.cacheEntryPatch.normalized_phone, null);
    assert.equal(result.plan.cacheEntryPatch.phone_type, null);
    assert.equal(result.plan.cacheEntryPatch.suppressed_at, NOW);
    assert.equal(result.plan.cacheEntryPatch.suppression_reason, 'dsar_request');
    assert.equal(result.plan.cacheEntryPatch.suppressed_by, 'user-admin-1');
  });

  it('los candidatos pierden el teléfono y el bloque phone de la metadata', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.candidatePatches.length, 2);
    for (const { patch } of result.plan.candidatePatches) {
      assert.equal(patch.phone, null);
      assert.equal(
        Object.prototype.hasOwnProperty.call(patch.enrichment_metadata, 'phone'),
        false,
      );
      assert.equal(JSON.stringify(patch).includes(FAKE_PHONE), false);
    }
  });

  it('la metadata no relacionada con el teléfono se conserva intacta', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const first = result.plan.candidatePatches[0]?.patch.enrichment_metadata as
      | Record<string, unknown>
      | undefined;
    assert.deepEqual(first?.relevance, { score: 0.9 });
  });

  it('strip devuelve un objeto NUEVO y no muta el original', () => {
    const original = { phone: { number: FAKE_PHONE }, relevance: { score: 1 } } as never;
    const stripped = stripPhoneFromEnrichmentMetadata(original);
    assert.equal(Object.prototype.hasOwnProperty.call(stripped, 'phone'), false);
    assert.equal(
      Object.prototype.hasOwnProperty.call(original as object, 'phone'),
      true,
    );
  });

  it('los contactos enlazados pierden phone y mobile_phone y su procedencia', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ids = result.plan.contactPatches.map((c) => c.contactId).sort();
    // contact-1 por FK matched_contacts_id; contact-2 por metadata.source_candidate_id.
    assert.deepEqual(ids, ['contact-1', 'contact-2']);
    for (const { patch } of result.plan.contactPatches) {
      assert.equal(patch.phone, null);
      assert.equal(patch.mobile_phone, null);
      assert.equal(patch.phone_source, null);
      assert.equal(patch.phone_type, null);
      assert.equal(patch.phone_raw_type, null);
    }
  });

  it('NUNCA toca un contacto de otra cuenta', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ids = result.plan.contactPatches.map((c) => c.contactId);
    assert.equal(ids.includes('contact-9'), false);
  });

  it('NUNCA toca un candidato de otra cuenta', () => {
    const result = plan(
      {},
      {
        candidates: [
          { id: 'cand-other', accountId: ACCOUNT_B, enrichmentMetadata: {}, matchedContactId: null },
        ],
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.candidatePatches.length, 0);
  });
});

// ── Efecto del tombstone ───────────────────────────────────────

describe('CACHE-1b supresión — el tombstone bloquea después', () => {
  it('una entrada con el patch de supresión aplicado ya no puede servirse', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const suppressedEntry = {
      id: 'cache-entry-1',
      provider: 'apollo',
      providerPersonId: PERSON_ID,
      accountId: ACCOUNT_A,
      countryCode: 'CO',
      normalizedPhone: result.plan.cacheEntryPatch.normalized_phone,
      phoneType: result.plan.cacheEntryPatch.phone_type,
      phoneSource: 'apollo_reveal',
      originalRevealedAt: '2026-07-01T00:00:00.000Z',
      expiresAt: '2026-09-29T00:00:00.000Z',
      hitCount: 0,
      suppressedAt: result.plan.cacheEntryPatch.suppressed_at,
    };
    const evaluation = evaluatePhoneCacheLookup(
      {
        provider: 'apollo',
        providerPersonId: PERSON_ID,
        accountId: ACCOUNT_A,
        countryCode: 'CO',
      },
      suppressedEntry,
      NOW,
    );
    assert.equal(evaluation.outcome, 'blocked_suppressed');
    assert.equal(evaluation.entry, null);
  });
});

// ── Auditoría sin PII ──────────────────────────────────────────

describe('CACHE-1b supresión — auditoría sin PII', () => {
  it('registra hash, cuenta, motivo y conteos, nunca el teléfono ni el id en claro', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const audit = buildPhoneCacheSuppressionAudit({
      plan: result.plan,
      providerPersonIdHash: 'ab12'.repeat(16),
      actorUserId: 'user-admin-1',
      reason: 'dsar_request',
      cacheEntriesSuppressed: 1,
    });
    const serialized = JSON.stringify(audit);
    assert.equal(serialized.includes(FAKE_PHONE), false);
    assert.equal(serialized.includes(PERSON_ID), false);
    assert.equal(audit.metadata.hard_delete, true);
    assert.equal(audit.metadata.tombstone, true);
    assert.equal(audit.metadata.cache_entries_suppressed, 1);
    assert.equal(audit.metadata.candidates_cleared, 2);
    assert.equal(audit.metadata.contacts_cleared, 2);
    assert.equal(audit.metadata.account_id, ACCOUNT_A);
  });
});

/**
 * Agente 2A — Apollo Phone Cache SUPPRESSION (APOLLO-PHONE-CACHE-1b)
 *
 * Pruebas offline del core puro de supresión. La supresión es la condición bajo
 * la que se aprobó la caché: un teléfono reutilizado tiene que poder borrarse de
 * verdad — en la caché, en los candidatos y en los contactos oficiales — dejando
 * un tombstone que bloquee reutilizaciones y reveals futuros.
 *
 * Incluye las regresiones del endurecimiento posterior a la revisión del PR:
 *   * B1 — un vínculo `matched_contacts_id` DÉBIL (name-only /
 *     possible_duplicate) NO puede borrar el teléfono de otra persona.
 *   * B2 — sin fila de caché previa se crea igualmente un tombstone, que bloquea
 *     hits y reveals automáticos futuros.
 *   * M1 — un teléfono manual o curado NUNCA se borra.
 *   * M2 — el alcance de cuenta es simétrico; un candidato sin cuenta resoluble
 *     no se procesa.
 *   * M5 — el motivo es una allowlist cerrada: texto libre con PII se rechaza.
 *
 * Sin red, sin Supabase, sin reloj real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPhoneCacheSuppressionAuditRow,
  buildPhoneCacheSuppressionPlan,
  buildPhoneCacheTombstoneDecision,
  isPhoneCacheSuppressionReasonCode,
  resolveCandidateContactLinkStrength,
  stripPhoneFromEnrichmentMetadata,
  PHONE_CACHE_SUPPRESSION_AUTHORIZED_ROLE_KEYS,
  PHONE_CACHE_SUPPRESSION_REASON_CODES,
  SUPPRESSIBLE_CONTACT_PHONE_SOURCES,
  type SuppressibleCandidate,
  type SuppressibleContact,
} from '../phone-cache-suppression-core';
import {
  buildPhoneCacheWriteDecision,
  evaluatePhoneCacheLookup,
} from '../phone-cache-core';

const NOW = '2026-07-29T12:00:00.000Z';
const PERSON_ID = '6a6826ba804c600014ead739';
const LUSHA_ID = 'v1.abcdefghijklmnop';
const ACCOUNT_A = 'acct-aaaa-1111';
const ACCOUNT_B = 'acct-bbbb-2222';
const RUN_A = 'run-aaaa-1111';
/** Teléfono ficticio de prueba. Nunca un número real. */
const FAKE_PHONE = '+570000000000';
const REASON = 'dsar_erasure_request';

const ADMIN = { actorUserId: 'user-admin-1', actorRoleKey: 'admin' };

function makeCandidate(
  overrides: Partial<SuppressibleCandidate> = {},
): SuppressibleCandidate {
  return {
    id: 'cand-1',
    accountId: ACCOUNT_A,
    enrichmentRunId: RUN_A,
    status: 'approved',
    duplicateStatus: 'no_match',
    matchedBy: null,
    createdContactId: 'contact-1',
    enrichmentMetadata: {
      relevance: { score: 0.9 },
      phone: { number: FAKE_PHONE, type: 'mobile', source: 'apollo_cache' },
    } as never,
    matchedContactId: 'contact-1',
    ...overrides,
  };
}

function makeContact(
  overrides: Partial<SuppressibleContact> = {},
): SuppressibleContact {
  return {
    id: 'contact-1',
    accountId: ACCOUNT_A,
    sourceCandidateId: 'cand-1',
    phoneSource: 'apollo_reveal',
    ...overrides,
  };
}

/** Escenario base: candidato aprobado → contacto creado desde él. */
function candidates(): SuppressibleCandidate[] {
  return [
    makeCandidate(),
    makeCandidate({
      id: 'cand-2',
      status: 'pending_review',
      createdContactId: null,
      matchedContactId: null,
      enrichmentMetadata: {
        phone: { number: FAKE_PHONE, type: 'mobile', source: 'apollo_reveal' },
      } as never,
    }),
  ];
}

function contacts(): SuppressibleContact[] {
  return [
    makeContact(),
    makeContact({ id: 'contact-2', sourceCandidateId: 'cand-2' }),
    // Cuenta distinta: NUNCA debe tocarse.
    makeContact({ id: 'contact-9', accountId: ACCOUNT_B, sourceCandidateId: 'cand-2' }),
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
      reason: REASON,
      ...ADMIN,
      ...inputOverrides,
    },
    { nowIso: NOW, candidates: candidates(), contacts: contacts(), ...contextOverrides },
  );
}

function clearedContactIds(
  result: ReturnType<typeof buildPhoneCacheSuppressionPlan>,
): string[] {
  if (!result.ok) return [];
  return result.plan.contactPatches.map((c) => c.contactId).sort();
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

// ── FIX M5: motivo = allowlist cerrada ─────────────────────────

describe('CACHE-1b supresión — FIX M5 motivo de allowlist', () => {
  it('la allowlist es cerrada y contiene solo códigos mecánicos', () => {
    assert.deepEqual([...PHONE_CACHE_SUPPRESSION_REASON_CODES], [
      'dsar_erasure_request',
      'do_not_contact_request',
      'legal_privacy_request',
      'admin_privacy_correction',
      'test_synthetic',
    ]);
    for (const code of PHONE_CACHE_SUPPRESSION_REASON_CODES) {
      assert.equal(isPhoneCacheSuppressionReasonCode(code), true);
    }
  });

  it('todos los códigos de la allowlist producen plan', () => {
    for (const code of PHONE_CACHE_SUPPRESSION_REASON_CODES) {
      const result = plan({ reason: code });
      assert.equal(result.ok, true, `${code} debería ser válido`);
    }
  });

  it('un motivo antiguo fuera de la allowlist se rechaza', () => {
    const result = plan({ reason: 'dsar_request' });
    assert.equal(result.ok === false && result.rejection, 'invalid_reason');
  });

  it('un motivo con teléfono se rechaza por allowlist (nunca se persiste PII)', () => {
    const result = plan({ reason: `borrar ${FAKE_PHONE} por solicitud` });
    assert.equal(result.ok === false && result.rejection, 'invalid_reason');
  });

  it('un motivo con email se rechaza por allowlist', () => {
    const result = plan({ reason: 'dsar de titular@empresa-ejemplo.test' });
    assert.equal(result.ok === false && result.rejection, 'invalid_reason');
  });
});

// ── FIX B2: tombstone sin fila de caché previa ─────────────────

describe('CACHE-1b supresión — FIX B2 tombstone sin caché previa', () => {
  it('sin país ISO-2 se rechaza explícitamente (no habría tombstone posible)', () => {
    for (const country of [null, '', 'Colombia', 'COL']) {
      const result = plan({ countryCode: country });
      assert.equal(
        result.ok === false && result.rejection,
        'missing_country',
        `país inesperadamente aceptado: ${String(country)}`,
      );
    }
  });

  it('la decisión del tombstone NO depende de candidatos ni contactos (FIX M4)', () => {
    // Se puede decidir y escribir el tombstone sin haber leído nada más, así que
    // un fallo al cargar candidatos/contactos no puede dejar sin bloquear.
    const decided = buildPhoneCacheTombstoneDecision(
      {
        providerPersonId: PERSON_ID,
        accountId: ACCOUNT_A,
        countryCode: 'CO',
        reason: REASON,
        ...ADMIN,
      },
      NOW,
    );
    assert.equal(decided.ok, true);
    if (!decided.ok) return;
    assert.equal(decided.tombstone.providerPersonId, PERSON_ID);
    assert.equal(decided.tombstone.tombstoneInsertRow.normalized_phone, null);
    assert.equal(decided.tombstone.cacheEntryPatch.suppressed_at, NOW);
  });

  it('la decisión del tombstone aplica los MISMOS rechazos que el plan', () => {
    const base: Parameters<typeof buildPhoneCacheTombstoneDecision>[0] = {
      providerPersonId: PERSON_ID,
      accountId: ACCOUNT_A,
      countryCode: 'CO',
      reason: REASON,
      ...ADMIN,
    };
    const cases: Array<[Partial<typeof base>, string]> = [
      [{ actorRoleKey: 'commercial_manager' }, 'unauthorized_role'],
      [{ providerPersonId: LUSHA_ID }, 'invalid_person_id'],
      [{ accountId: '' }, 'missing_account'],
      [{ reason: '  ' }, 'missing_reason'],
      [{ reason: 'texto libre' }, 'invalid_reason'],
      [{ countryCode: null }, 'missing_country'],
    ];
    for (const [override, expected] of cases) {
      const result = buildPhoneCacheTombstoneDecision({ ...base, ...override }, NOW);
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.rejection, expected);
    }
  });

  it('el plan siempre incluye una fila de tombstone lista para insertar', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const row = result.plan.tombstoneInsertRow;
    assert.equal(row.provider, 'apollo');
    assert.equal(row.provider_person_id, PERSON_ID);
    assert.equal(row.account_id, ACCOUNT_A);
    assert.equal(row.country_code, 'CO');
    assert.equal(row.normalized_phone, null);
    assert.equal(row.phone_type, null);
    assert.equal(row.suppressed_at, NOW);
    assert.equal(row.suppression_reason, REASON);
    assert.equal(row.suppressed_by, 'user-admin-1');
    // Nace expirada: ni limpiando suppressed_at podría servirse.
    assert.equal(row.expires_at, NOW);
  });

  it('el tombstone recién creado bloquea el cache hit posterior', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const row = result.plan.tombstoneInsertRow;
    const evaluation = evaluatePhoneCacheLookup(
      {
        provider: 'apollo',
        providerPersonId: PERSON_ID,
        accountId: ACCOUNT_A,
        countryCode: 'CO',
      },
      {
        id: 'cache-tombstone-1',
        provider: row.provider,
        providerPersonId: row.provider_person_id,
        accountId: row.account_id,
        countryCode: row.country_code,
        normalizedPhone: row.normalized_phone,
        phoneType: row.phone_type,
        phoneSource: 'apollo_reveal',
        originalRevealedAt: row.original_revealed_at,
        expiresAt: row.expires_at,
        hitCount: 0,
        suppressedAt: row.suppressed_at,
      },
      NOW,
    );
    assert.equal(evaluation.outcome, 'blocked_suppressed');
    assert.equal(evaluation.entry, null);
  });

  it('el tombstone recién creado impide que un reveal posterior repueble la caché', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const decision = buildPhoneCacheWriteDecision(
      {
        provider: 'apollo',
        providerPersonId: PERSON_ID,
        accountId: ACCOUNT_A,
        countryCode: 'CO',
        normalizedPhone: FAKE_PHONE,
        phoneType: 'mobile',
        phoneSource: 'apollo_reveal',
        originalRevealedAt: NOW,
        existingSuppressedAt: result.plan.tombstoneInsertRow.suppressed_at,
      },
      true,
    );
    assert.equal(decision.write, false);
    assert.equal(decision.write === false && decision.reason, 'suppressed_tombstone');
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
    assert.equal(result.plan.cacheEntryPatch.suppression_reason, REASON);
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

  it('el UPDATE del candidato queda acotado por su run (FIX M2/M3)', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    for (const entry of result.plan.candidatePatches) {
      assert.equal(entry.enrichmentRunId, RUN_A);
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
    assert.deepEqual(clearedContactIds(result), ['contact-1', 'contact-2']);
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
    assert.equal(clearedContactIds(result).includes('contact-9'), false);
  });

  it('NUNCA toca un candidato de otra cuenta', () => {
    const result = plan(
      {},
      { candidates: [makeCandidate({ id: 'cand-other', accountId: ACCOUNT_B })] },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.candidatePatches.length, 0);
  });
});

// ── FIX B1: la fuerza del vínculo decide ───────────────────────

describe('CACHE-1b supresión — FIX B1 vínculo de procedencia probable', () => {
  it('contacto CREADO desde el candidato ⇒ provenance_proven', () => {
    assert.equal(resolveCandidateContactLinkStrength(makeCandidate()), 'provenance_proven');
  });

  it('duplicado EXACTO por email ⇒ strong_duplicate', () => {
    assert.equal(
      resolveCandidateContactLinkStrength(
        makeCandidate({
          status: 'duplicate',
          duplicateStatus: 'exact_duplicate',
          matchedBy: 'email',
          createdContactId: null,
          matchedContactId: 'contact-dup',
        }),
      ),
      'strong_duplicate',
    );
  });

  it('duplicado EXACTO por linkedin ⇒ strong_duplicate', () => {
    assert.equal(
      resolveCandidateContactLinkStrength(
        makeCandidate({
          status: 'duplicate',
          duplicateStatus: 'exact_duplicate',
          matchedBy: 'linkedin',
          createdContactId: null,
          matchedContactId: 'contact-dup',
        }),
      ),
      'strong_duplicate',
    );
  });

  it('match por NOMBRE ⇒ weak (aunque el duplicate_status dijera exacto)', () => {
    assert.equal(
      resolveCandidateContactLinkStrength(
        makeCandidate({
          status: 'duplicate',
          duplicateStatus: 'exact_duplicate',
          matchedBy: 'name',
          createdContactId: null,
          matchedContactId: 'contact-x',
        }),
      ),
      'weak',
    );
  });

  it('possible_duplicate ⇒ weak', () => {
    assert.equal(
      resolveCandidateContactLinkStrength(
        makeCandidate({
          status: 'duplicate',
          duplicateStatus: 'possible_duplicate',
          matchedBy: 'email',
          createdContactId: null,
          matchedContactId: 'contact-x',
        }),
      ),
      'weak',
    );
  });

  it('FK sin evidencia (ni aprobado ni duplicado exacto) ⇒ weak', () => {
    assert.equal(
      resolveCandidateContactLinkStrength(
        makeCandidate({
          status: 'pending_review',
          duplicateStatus: 'unchecked',
          matchedBy: null,
          createdContactId: null,
          matchedContactId: 'contact-x',
        }),
      ),
      'weak',
    );
  });

  it('aprobado pero el FK apunta a OTRO contacto que el creado ⇒ weak', () => {
    assert.equal(
      resolveCandidateContactLinkStrength(
        makeCandidate({ createdContactId: 'contact-1', matchedContactId: 'contact-otro' }),
      ),
      'weak',
    );
  });

  /**
   * REGRESIÓN EXIGIDA: "José Pérez" vs "Jose Perez". Candidato Apollo sin email
   * ni LinkedIn cuyo `matched_contacts_id` se fijó por coincidencia SOLO de
   * nombre (possible_duplicate). Suprimir a la persona del candidato NO puede
   * borrar el teléfono del contacto X, que puede ser otra persona distinta.
   */
  it('name-only / possible_duplicate NO borra el teléfono del contacto X', () => {
    const nameOnlyCandidate = makeCandidate({
      id: 'cand-jose',
      status: 'duplicate',
      duplicateStatus: 'possible_duplicate',
      matchedBy: 'name',
      createdContactId: null,
      matchedContactId: 'contact-x',
    });
    const result = plan(
      {},
      {
        candidates: [nameOnlyCandidate],
        contacts: [
          // Contacto X: mismo nombre normalizado, otra persona. Su
          // metadata.source_candidate_id NO apunta al candidato suprimido.
          makeContact({
            id: 'contact-x',
            sourceCandidateId: null,
            phoneSource: 'apollo_reveal',
          }),
        ],
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.contactPatches, []);
    // El candidato propio sí se limpia: eso nunca estuvo en duda.
    assert.equal(result.plan.candidatePatches.length, 1);
  });

  it('un duplicado exacto por email SÍ borra el contacto enlazado', () => {
    const result = plan(
      {},
      {
        candidates: [
          makeCandidate({
            id: 'cand-dup',
            status: 'duplicate',
            duplicateStatus: 'exact_duplicate',
            matchedBy: 'email',
            createdContactId: null,
            matchedContactId: 'contact-dup',
          }),
        ],
        contacts: [makeContact({ id: 'contact-dup', sourceCandidateId: null })],
      },
    );
    assert.deepEqual(clearedContactIds(result), ['contact-dup']);
  });
});

// ── FIX M1: no borrar teléfonos manuales / curados ─────────────

describe('CACHE-1b supresión — FIX M1 procedencia del teléfono del contacto', () => {
  it('solo apollo_reveal y apollo_cache son borrables', () => {
    assert.deepEqual([...SUPPRESSIBLE_CONTACT_PHONE_SOURCES], [
      'apollo_reveal',
      'apollo_cache',
    ]);
  });

  it('un teléfono manual NO se borra aunque el vínculo sea probado', () => {
    const result = plan(
      {},
      { contacts: [makeContact({ phoneSource: 'manual' })] },
    );
    assert.deepEqual(result.ok && result.plan.contactPatches, []);
  });

  for (const source of [
    'manual',
    'provider_payload',
    'apollo_search',
    'lusha_reveal',
    'unknown',
    'future_unapproved_source',
    null,
  ]) {
    it(`procedencia ${String(source)} ⇒ no se borra`, () => {
      const result = plan({}, { contacts: [makeContact({ phoneSource: source })] });
      assert.deepEqual(clearedContactIds(result), []);
    });
  }

  for (const source of ['apollo_reveal', 'apollo_cache']) {
    it(`procedencia ${source} ⇒ sí se borra`, () => {
      const result = plan({}, { contacts: [makeContact({ phoneSource: source })] });
      assert.deepEqual(clearedContactIds(result), ['contact-1']);
    });
  }
});

// ── FIX M2/M3: alcance simétrico de cuenta ─────────────────────

describe('CACHE-1b supresión — FIX M2/M3 alcance de cuenta simétrico', () => {
  it('un candidato SIN cuenta resoluble no se procesa (antes se admitía null)', () => {
    const result = plan(
      {},
      { candidates: [makeCandidate({ accountId: null })], contacts: [] },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.candidatePatches.length, 0);
    assert.equal(result.plan.contactPatches.length, 0);
  });

  it('un contacto de otra cuenta NO se borra aunque el FK apunte a él', () => {
    const result = plan(
      {},
      {
        candidates: [makeCandidate({ matchedContactId: 'contact-cross' })],
        contacts: [
          makeContact({
            id: 'contact-cross',
            accountId: ACCOUNT_B,
            sourceCandidateId: 'cand-1',
          }),
        ],
      },
    );
    assert.deepEqual(clearedContactIds(result), []);
  });

  it('un contacto sin cuenta resoluble tampoco se borra', () => {
    const result = plan(
      {},
      { contacts: [makeContact({ accountId: null })] },
    );
    assert.deepEqual(clearedContactIds(result), []);
  });
});

// ── Auditoría durable sin PII (FIX H3) ─────────────────────────

describe('CACHE-1b supresión — FIX H3 auditoría durable sin PII', () => {
  it('la fila de auditoría registra hash, cuenta, motivo y conteos REALES', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const row = buildPhoneCacheSuppressionAuditRow({
      plan: result.plan,
      providerPersonIdHash: 'ab12'.repeat(16),
      cacheRowsSuppressed: 1,
      tombstoneCreated: true,
      // Conteos REALES (lo que la DB reportó), no las longitudes del plan.
      candidatesCleared: 2,
      contactsCleared: 1,
    });
    assert.equal(row.provider, 'apollo');
    assert.equal(row.account_id, ACCOUNT_A);
    assert.equal(row.country_code, 'CO');
    assert.equal(row.reason_code, REASON);
    assert.equal(row.actor_user_id, 'user-admin-1');
    assert.equal(row.cache_rows_suppressed, 1);
    assert.equal(row.tombstone_created, true);
    assert.equal(row.candidates_cleared, 2);
    // El plan tenía 2 contactos pero la DB solo actualizó 1: manda la realidad.
    assert.equal(row.contacts_cleared, 1);
    assert.equal(row.metadata.hard_delete, true);
    assert.equal(row.metadata.tombstone, true);
  });

  it('la fila de auditoría no contiene teléfono ni el person id en claro', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const row = buildPhoneCacheSuppressionAuditRow({
      plan: result.plan,
      providerPersonIdHash: 'ab12'.repeat(16),
      cacheRowsSuppressed: 1,
      tombstoneCreated: false,
      candidatesCleared: 2,
      contactsCleared: 2,
    });
    const serialized = JSON.stringify(row);
    assert.equal(serialized.includes(FAKE_PHONE), false);
    assert.equal(serialized.includes(PERSON_ID), false);
    // Ni nombre, ni email, ni linkedin: la fila no tiene esos campos.
    for (const banned of ['email', 'linkedin', 'full_name', 'first_name']) {
      assert.equal(serialized.includes(banned), false, `no debe contener ${banned}`);
    }
  });

  it('la metadata solo lleva etiquetas mecánicas de fuerza de vínculo', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const row = buildPhoneCacheSuppressionAuditRow({
      plan: result.plan,
      providerPersonIdHash: 'ab12'.repeat(16),
      cacheRowsSuppressed: 1,
      tombstoneCreated: false,
      candidatesCleared: 2,
      contactsCleared: 2,
    });
    for (const strength of row.metadata.contact_link_strengths) {
      assert.ok(
        ['provenance_proven', 'strong_duplicate'].includes(strength),
        `fuerza inesperada: ${strength}`,
      );
    }
  });
});

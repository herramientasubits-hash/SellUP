/**
 * Agente 2A — Apollo Phone Cache SUPPRESSION (APOLLO-PHONE-CACHE-1b)
 *
 * Pruebas offline del core puro de supresión. La supresión es la condición bajo
 * la que se aprobó la caché: un teléfono reutilizado tiene que poder borrarse de
 * verdad — en la caché, en los candidatos y en los contactos oficiales — dejando
 * un tombstone que bloquee reutilizaciones y reveals futuros.
 *
 * Incluye las regresiones del endurecimiento posterior a la revisión del PR:
 *   * FIX 1 — v1 exige procedencia CREADO/PROMOVIDO
 *     (`contacts.metadata.source_candidate_id`). Ni `matched_contacts_id`, ni un
 *     duplicado exacto por email/linkedin, ni un match por nombre bastan para
 *     borrar el teléfono de un contacto oficial.
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
  resolveContactErasureProvenance,
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

  // 4O-E4.1: `mobile_phone` salió del patch. La columna no tiene procedencia que
  // ninguna de estas fuentes pueda reclamar, así que la erasure alcanza la tupla de
  // `phone` y nada más.
  it('los contactos enlazados pierden phone y su procedencia, NO el celular', () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(clearedContactIds(result), ['contact-1', 'contact-2']);
    for (const { patch } of result.plan.contactPatches) {
      assert.equal(patch.phone, null);
      assert.equal(
        Object.prototype.hasOwnProperty.call(patch, 'mobile_phone'),
        false,
        'sin procedencia no hay borrado destructivo',
      );
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

// ── FIX 1: solo procedencia CREADO/PROMOVIDO borra contacts ─────
// v1 exige que el CONTACTO acredite su propio origen
// (`contacts.metadata.source_candidate_id` → un candidato del conjunto
// suprimido). El FK `matched_contacts_id` y `review.created_contact_id` sirven
// para ENCONTRAR filas; ninguno autoriza el borrado. Un duplicado — exacto o
// posible, por email, linkedin o nombre — es `weak` y NO borra: identifica a la
// persona, pero no demuestra que este candidato pusiera el teléfono en esa fila.

describe('CACHE-1b supresión — FIX 1 procedencia creado/promovido obligatoria', () => {
  const ids = (...values: string[]) => new Set(values);

  it('metadata.source_candidate_id apunta a un candidato suprimido ⇒ provenance_proven', () => {
    assert.equal(
      resolveContactErasureProvenance({
        contact: makeContact({ sourceCandidateId: 'cand-1' }),
        suppressedCandidateIds: ids('cand-1'),
      }),
      'provenance_proven',
    );
  });

  it('sin metadata.source_candidate_id ⇒ weak', () => {
    assert.equal(
      resolveContactErasureProvenance({
        contact: makeContact({ sourceCandidateId: null }),
        suppressedCandidateIds: ids('cand-1'),
      }),
      'weak',
    );
  });

  it('metadata.source_candidate_id de OTRO candidato ⇒ weak', () => {
    assert.equal(
      resolveContactErasureProvenance({
        contact: makeContact({ sourceCandidateId: 'cand-ajeno' }),
        suppressedCandidateIds: ids('cand-1'),
      }),
      'weak',
    );
  });

  it('el tipo de fuerza ya no admite un nivel intermedio erase-safe', () => {
    // Si alguien reintrodujera `strong_duplicate`, esta aserción lo delataría:
    // el único valor no-weak posible en v1 es `provenance_proven`.
    const strengths = new Set<string>();
    for (const sourceCandidateId of ['cand-1', 'cand-ajeno', null]) {
      strengths.add(
        resolveContactErasureProvenance({
          contact: makeContact({ sourceCandidateId }),
          suppressedCandidateIds: ids('cand-1'),
        }),
      );
    }
    assert.deepEqual([...strengths].sort(), ['provenance_proven', 'weak']);
  });

  it('el FK `matched_contacts_id` NO basta por sí solo para borrar', () => {
    const result = plan(
      {},
      {
        candidates: [makeCandidate({ matchedContactId: 'contact-fk' })],
        // El contacto existe y está enlazado por el FK, pero no acredita origen.
        contacts: [makeContact({ id: 'contact-fk', sourceCandidateId: null })],
      },
    );
    assert.deepEqual(clearedContactIds(result), []);
  });

  /**
   * REGRESIÓN: duplicado EXACTO por email. En v1 esto ya NO borra el contacto.
   * El candidato se emparejó con un contacto preexistente que este candidato
   * nunca escribió: su teléfono puede ser anterior al reveal, venir de otro
   * proveedor o haberlo tecleado una persona. Se limpia el candidato, no el
   * contacto ajeno.
   */
  it('duplicado EXACTO por email ya NO borra el contacto enlazado (cambio v1)', () => {
    const result = plan(
      {},
      {
        candidates: [
          makeCandidate({
            id: 'cand-dup',
            createdContactId: null,
            matchedContactId: 'contact-dup',
          }),
        ],
        contacts: [makeContact({ id: 'contact-dup', sourceCandidateId: null })],
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.contactPatches, []);
    // El candidato propio sí se limpia: eso nunca estuvo en duda.
    assert.equal(result.plan.candidatePatches.length, 1);
  });

  it('duplicado EXACTO por linkedin tampoco borra el contacto enlazado', () => {
    const result = plan(
      {},
      {
        candidates: [
          makeCandidate({
            id: 'cand-dup-li',
            createdContactId: null,
            matchedContactId: 'contact-dup-li',
          }),
        ],
        contacts: [makeContact({ id: 'contact-dup-li', sourceCandidateId: null })],
      },
    );
    assert.deepEqual(clearedContactIds(result), []);
  });

  /**
   * REGRESIÓN EXIGIDA: "José Pérez" vs "Jose Perez". Candidato Apollo sin email
   * ni LinkedIn cuyo `matched_contacts_id` se fijó por coincidencia SOLO de
   * nombre. Suprimir a la persona del candidato NO puede borrar el teléfono del
   * contacto X, que puede ser otra persona distinta.
   */
  it('name-only NO borra el teléfono del contacto X', () => {
    const result = plan(
      {},
      {
        candidates: [
          makeCandidate({
            id: 'cand-jose',
            createdContactId: null,
            matchedContactId: 'contact-x',
          }),
        ],
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
    assert.equal(result.plan.candidatePatches.length, 1);
  });

  it('un contacto CREADO desde el candidato SÍ se borra', () => {
    const result = plan(
      {},
      {
        candidates: [makeCandidate({ id: 'cand-1' })],
        contacts: [makeContact({ id: 'contact-1', sourceCandidateId: 'cand-1' })],
      },
    );
    assert.deepEqual(clearedContactIds(result), ['contact-1']);
    if (!result.ok) return;
    assert.equal(result.plan.contactPatches[0]?.linkStrength, 'provenance_proven');
  });

  it('la procedencia debe apuntar a un candidato DE LA MISMA cuenta', () => {
    // El contacto acredita origen en cand-other, pero ese candidato es de otra
    // cuenta y por tanto queda fuera del conjunto suprimido.
    const result = plan(
      {},
      {
        candidates: [makeCandidate({ id: 'cand-other', accountId: ACCOUNT_B })],
        contacts: [makeContact({ id: 'contact-1', sourceCandidateId: 'cand-other' })],
      },
    );
    assert.deepEqual(clearedContactIds(result), []);
  });
});

// ── FIX M1: no borrar teléfonos manuales / curados ─────────────

describe('CACHE-1b supresión — FIX M1 procedencia del teléfono del contacto', () => {
  // 4O-E4 amplió la allowlist a `lusha_reveal` con la cadena de procedencia
  // demostrada de punta a punta. El detalle de esa admisión —y el límite de
  // `mobile_phone`— vive en `phone-contacts-privacy-erasure-4o-e4.test.ts`.
  it('solo apollo_reveal, apollo_cache y lusha_reveal son borrables', () => {
    assert.deepEqual([...SUPPRESSIBLE_CONTACT_PHONE_SOURCES], [
      'apollo_reveal',
      'apollo_cache',
      'lusha_reveal',
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
    'unknown',
    'future_unapproved_source',
    null,
  ]) {
    it(`procedencia ${String(source)} ⇒ no se borra`, () => {
      const result = plan({}, { contacts: [makeContact({ phoneSource: source })] });
      assert.deepEqual(clearedContactIds(result), []);
    });
  }

  for (const source of ['apollo_reveal', 'apollo_cache', 'lusha_reveal']) {
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
      // 4O-E2: filas de la colección canónica realmente tombstoneadas, y los
      // agregados PII-free de la reelección del principal.
      candidatePhoneRowsSuppressed: 3,
      candidatePhoneSurvivorCount: 0,
      candidatePhonePrimaryChanged: true,
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
    // 4O-E2: el conteo de la colección es una COLUMNA tipada, no una clave dentro
    // de `metadata`, igual que los otros tres.
    assert.equal(row.candidate_phone_rows_suppressed, 3);
    assert.equal(row.metadata.candidate_phone_survivor_count, 0);
    assert.equal(row.metadata.candidate_phone_primary_changed, true);
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
      candidatePhoneRowsSuppressed: 2,
      candidatePhoneSurvivorCount: 0,
      candidatePhonePrimaryChanged: true,
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
      candidatePhoneRowsSuppressed: 2,
      candidatePhoneSurvivorCount: 0,
      candidatePhonePrimaryChanged: true,
      contactsCleared: 2,
    });
    // En v1 la única fuerza que puede aparecer es `provenance_proven`: nada más
    // llega a `contactPatches` (FIX 1).
    assert.deepEqual(row.metadata.contact_link_strengths, ['provenance_proven']);
  });
});

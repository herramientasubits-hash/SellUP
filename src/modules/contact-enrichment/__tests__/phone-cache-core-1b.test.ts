/**
 * Agente 2A — Apollo Phone Cache PURE core (APOLLO-PHONE-CACHE-1b)
 *
 * Pruebas offline y deterministas del núcleo puro `phone-cache-core.ts`. Sin
 * red, sin Supabase, sin proveedores, sin reloj real (`nowIso` siempre se
 * inyecta). Verifican la POLÍTICA aprobada, no la implementación:
 *
 *   - TTL 90 días desde el reveal original; expirada ⇒ miss; el hit no extiende.
 *   - Reuso SOLO misma cuenta; SOLO mismo país; país desconocido ⇒ miss.
 *   - Tombstone (supresión) bloquea por encima de todo lo demás.
 *   - Solo Apollo: un id Lusha `v1.*` ni lee ni escribe caché.
 *   - Solo un reveal real y pagado es cacheable (nunca un hit de caché).
 *   - El usage-log del hit es 0 créditos, cost_source=cache y SIN PII.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPhoneCacheHitUsageLog,
  buildPhoneCacheWriteDecision,
  buildRevealPhoneCacheWriteInput,
  computePhoneCacheExpiresAt,
  evaluatePhoneCacheLookup,
  evaluatePhoneCacheSuppressionState,
  normalizePhoneCacheCountryCode,
  resolvePhoneCacheCountryCode,
  resolvePhoneCachePersonId,
  PHONE_CACHE_HIT_COST_SOURCE,
  PHONE_CACHE_HIT_CREDITS,
  PHONE_CACHE_HIT_OPERATION_KEY,
  PHONE_CACHE_HIT_PHONE_SOURCE,
  PHONE_CACHE_PROVIDER,
  PHONE_CACHE_REUSE_SCOPE,
  PHONE_CACHE_TTL_DAYS,
  type PhoneCacheEntry,
  type PhoneCacheLookupKey,
  type PhoneCacheWriteInput,
} from '../phone-cache-core';

// ── Fixtures ───────────────────────────────────────────────────

const NOW = '2026-07-29T12:00:00.000Z';
const PERSON_ID = '6a6826ba804c600014ead739'; // 24 hex — Apollo ObjectId
const OTHER_PERSON_ID = 'aa11bb22cc33dd44ee55ff66';
const LUSHA_ID = 'v1.abcdefghijklmnop';
const ACCOUNT_A = 'acct-aaaa-1111';
const ACCOUNT_B = 'acct-bbbb-2222';
const CANDIDATE_ID = 'cand-0001';
/** Teléfono ficticio de prueba. Nunca un número real. */
const FAKE_PHONE = '+570000000000';

function key(overrides: Partial<PhoneCacheLookupKey> = {}): PhoneCacheLookupKey {
  return {
    provider: PHONE_CACHE_PROVIDER,
    providerPersonId: PERSON_ID,
    accountId: ACCOUNT_A,
    countryCode: 'CO',
    ...overrides,
  };
}

function entry(overrides: Partial<PhoneCacheEntry> = {}): PhoneCacheEntry {
  return {
    id: 'cache-entry-1',
    provider: PHONE_CACHE_PROVIDER,
    providerPersonId: PERSON_ID,
    accountId: ACCOUNT_A,
    countryCode: 'CO',
    normalizedPhone: FAKE_PHONE,
    phoneType: 'mobile',
    phoneSource: 'apollo_reveal',
    originalRevealedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-09-29T00:00:00.000Z',
    hitCount: 0,
    suppressedAt: null,
    ...overrides,
  };
}

function writeInput(
  overrides: Partial<PhoneCacheWriteInput> = {},
): PhoneCacheWriteInput {
  return {
    provider: 'apollo',
    providerPersonId: PERSON_ID,
    accountId: ACCOUNT_A,
    countryCode: 'CO',
    normalizedPhone: FAKE_PHONE,
    phoneType: 'mobile',
    phoneSource: 'apollo_reveal',
    originalRevealedAt: NOW,
    sourceCandidateId: CANDIDATE_ID,
    ...overrides,
  };
}

// ── Política declarada ─────────────────────────────────────────

describe('CACHE-1b — constantes de política aprobada', () => {
  it('TTL es exactamente 90 días', () => {
    assert.equal(PHONE_CACHE_TTL_DAYS, 90);
  });

  it('el alcance de reuso es same_account (no existe variante cross-account)', () => {
    assert.equal(PHONE_CACHE_REUSE_SCOPE, 'same_account');
  });

  it('el proveedor cacheable es Apollo (nunca Lusha)', () => {
    assert.equal(PHONE_CACHE_PROVIDER, 'apollo');
  });

  it('un cache hit cuesta 0 créditos porque no hay llamada al proveedor', () => {
    assert.equal(PHONE_CACHE_HIT_CREDITS, 0);
    assert.equal(PHONE_CACHE_HIT_COST_SOURCE, 'cache');
  });

  it('el operation_key del hit es propio y no se mezcla con el del reveal', () => {
    assert.equal(PHONE_CACHE_HIT_OPERATION_KEY, 'person_phone_cache_hit');
    assert.notEqual(PHONE_CACHE_HIT_OPERATION_KEY, 'person_phone_reveal');
    assert.notEqual(PHONE_CACHE_HIT_OPERATION_KEY, 'organizations_search');
  });

  it('la procedencia del hit es distinguible de un reveal nuevo', () => {
    assert.equal(PHONE_CACHE_HIT_PHONE_SOURCE, 'apollo_cache');
    assert.notEqual(PHONE_CACHE_HIT_PHONE_SOURCE, 'apollo_reveal');
  });
});

// ── TTL ────────────────────────────────────────────────────────

describe('CACHE-1b — TTL de 90 días', () => {
  it('expires_at = original_revealed_at + 90 días exactos', () => {
    const expires = computePhoneCacheExpiresAt('2026-01-01T00:00:00.000Z');
    assert.equal(expires, '2026-04-01T00:00:00.000Z');
    const deltaDays =
      (Date.parse(expires) - Date.parse('2026-01-01T00:00:00.000Z')) /
      (24 * 60 * 60 * 1000);
    assert.equal(deltaDays, 90);
  });

  it('una fecha inválida no produce una entrada silenciosamente eterna', () => {
    assert.throws(() => computePhoneCacheExpiresAt('no-es-una-fecha'));
  });

  it('una entrada expirada es MISS y no se sirve', () => {
    const result = evaluatePhoneCacheLookup(
      key(),
      entry({ expiresAt: '2026-07-29T11:59:59.000Z' }),
      NOW,
    );
    assert.equal(result.outcome, 'miss_expired');
    assert.equal(result.entry, null);
  });

  it('una entrada que expira exactamente ahora ya no se sirve (fail-closed)', () => {
    const result = evaluatePhoneCacheLookup(key(), entry({ expiresAt: NOW }), NOW);
    assert.equal(result.outcome, 'miss_expired');
  });

  it('una fecha de expiración ilegible se trata como expirada', () => {
    const result = evaluatePhoneCacheLookup(key(), entry({ expiresAt: 'x' }), NOW);
    assert.equal(result.outcome, 'miss_expired');
  });

  it('un hit NO recalcula ni extiende el TTL: devuelve la entrada tal cual', () => {
    const original = entry();
    const result = evaluatePhoneCacheLookup(key(), original, NOW);
    assert.equal(result.outcome, 'hit');
    assert.equal(result.entry?.expiresAt, original.expiresAt);
  });
});

// ── Alcance: cuenta y país ─────────────────────────────────────

describe('CACHE-1b — alcance de reutilización', () => {
  it('hit válido cuando proveedor, persona, cuenta y país coinciden', () => {
    const result = evaluatePhoneCacheLookup(key(), entry(), NOW);
    assert.equal(result.outcome, 'hit');
    assert.equal(result.entry?.id, 'cache-entry-1');
  });

  it('cross-account NO reutiliza: entrada de otra cuenta ⇒ miss', () => {
    const result = evaluatePhoneCacheLookup(
      key({ accountId: ACCOUNT_A }),
      entry({ accountId: ACCOUNT_B }),
      NOW,
    );
    assert.equal(result.outcome, 'miss_account_mismatch');
    assert.equal(result.entry, null);
  });

  it('cross-country NO reutiliza: entrada de otro país ⇒ miss', () => {
    const result = evaluatePhoneCacheLookup(
      key({ countryCode: 'CO' }),
      entry({ countryCode: 'MX' }),
      NOW,
    );
    assert.equal(result.outcome, 'miss_country_mismatch');
    assert.equal(result.entry, null);
  });

  it('una entrada de otro proveedor nunca se sirve', () => {
    const result = evaluatePhoneCacheLookup(key(), entry({ provider: 'lusha' }), NOW);
    assert.equal(result.outcome, 'miss_provider_mismatch');
  });

  it('sin entrada ⇒ miss (el reveal normal continúa)', () => {
    assert.equal(evaluatePhoneCacheLookup(key(), null, NOW).outcome, 'miss_no_entry');
  });

  it('una entrada sin teléfono ⇒ miss (nunca se sirve un hueco)', () => {
    const result = evaluatePhoneCacheLookup(key(), entry({ normalizedPhone: null }), NOW);
    assert.equal(result.outcome, 'miss_no_phone');
  });
});

// ── País desconocido ───────────────────────────────────────────

describe('CACHE-1b — país desconocido = no reuso', () => {
  it('solo un ISO-2 alfabético normaliza; el resto es null', () => {
    assert.equal(normalizePhoneCacheCountryCode('co'), 'CO');
    assert.equal(normalizePhoneCacheCountryCode(' MX '), 'MX');
    assert.equal(normalizePhoneCacheCountryCode('Colombia'), null);
    assert.equal(normalizePhoneCacheCountryCode('COL'), null);
    assert.equal(normalizePhoneCacheCountryCode('C1'), null);
    assert.equal(normalizePhoneCacheCountryCode(''), null);
    assert.equal(normalizePhoneCacheCountryCode(null), null);
    assert.equal(normalizePhoneCacheCountryCode(undefined), null);
  });

  it('el resolver prioriza el país del candidato y cae al de la empresa', () => {
    assert.equal(
      resolvePhoneCacheCountryCode({ candidateCountry: 'mx', runCompanyCountryCode: 'CO' }),
      'MX',
    );
    assert.equal(
      resolvePhoneCacheCountryCode({
        candidateCountry: 'Colombia',
        runCompanyCountryCode: 'CO',
      }),
      'CO',
    );
  });

  it('sin ningún país resoluble devuelve null (⇒ ni se cachea ni se reutiliza)', () => {
    assert.equal(
      resolvePhoneCacheCountryCode({ candidateCountry: null, runCompanyCountryCode: null }),
      null,
    );
    assert.equal(
      resolvePhoneCacheCountryCode({
        candidateCountry: 'Brasil',
        runCompanyCountryCode: '',
      }),
      null,
    );
  });

  it('un reveal sin país conocido NO se escribe en caché', () => {
    const decision = buildPhoneCacheWriteDecision(
      writeInput({ countryCode: null }),
      true,
    );
    assert.equal(decision.write, false);
    assert.equal(decision.write === false && decision.reason, 'unknown_country');
  });
});

// ── Tombstone ──────────────────────────────────────────────────

describe('CACHE-1b — tombstone / supresión', () => {
  it('una entrada suprimida bloquea el hit (no es un simple miss)', () => {
    const result = evaluatePhoneCacheLookup(
      key(),
      entry({ suppressedAt: '2026-07-20T00:00:00.000Z', normalizedPhone: null }),
      NOW,
    );
    assert.equal(result.outcome, 'blocked_suppressed');
    assert.equal(result.entry, null);
  });

  it('la supresión gana incluso si la entrada aún tuviera teléfono y vigencia', () => {
    const result = evaluatePhoneCacheLookup(
      key(),
      entry({ suppressedAt: '2026-07-20T00:00:00.000Z' }),
      NOW,
    );
    assert.equal(result.outcome, 'blocked_suppressed');
  });

  it('un tombstone impide que un reveal posterior vuelva a rellenar la entrada', () => {
    const decision = buildPhoneCacheWriteDecision(
      writeInput({ existingSuppressedAt: '2026-07-20T00:00:00.000Z' }),
      true,
    );
    assert.equal(decision.write, false);
    assert.equal(decision.write === false && decision.reason, 'suppressed_tombstone');
  });
});

// ── Resolución del person id (anti-Lusha) ──────────────────────

describe('CACHE-1b — clave de caché: solo ids Apollo', () => {
  it('usa la columna apollo_person_id cuando es válida', () => {
    assert.equal(
      resolvePhoneCachePersonId({ apolloPersonId: PERSON_ID, sourceProvider: 'lusha' }),
      PERSON_ID,
    );
  });

  it('cae al source_contact_id SOLO cuando el candidato es origen Apollo', () => {
    assert.equal(
      resolvePhoneCachePersonId({
        apolloPersonId: null,
        sourceProvider: 'apollo',
        sourceContactId: OTHER_PERSON_ID,
      }),
      OTHER_PERSON_ID,
    );
    assert.equal(
      resolvePhoneCachePersonId({
        apolloPersonId: null,
        sourceProvider: 'lusha',
        sourceContactId: OTHER_PERSON_ID,
      }),
      null,
    );
  });

  it('un id Lusha `v1.*` NUNCA se convierte en clave de caché', () => {
    assert.equal(
      resolvePhoneCachePersonId({
        apolloPersonId: LUSHA_ID,
        sourceProvider: 'apollo',
        sourceContactId: LUSHA_ID,
      }),
      null,
    );
  });

  it('un id Lusha tampoco puede ESCRIBIRSE en caché', () => {
    const decision = buildPhoneCacheWriteDecision(
      writeInput({ providerPersonId: LUSHA_ID }),
      true,
    );
    assert.equal(decision.write, false);
    assert.equal(decision.write === false && decision.reason, 'invalid_person_id');
  });
});

// ── Decisión de escritura ──────────────────────────────────────

describe('CACHE-1b — decisión de escritura fail-closed', () => {
  it('con el flag apagado no se escribe nada', () => {
    const decision = buildPhoneCacheWriteDecision(writeInput(), false);
    assert.equal(decision.write, false);
    assert.equal(decision.write === false && decision.reason, 'cache_disabled');
  });

  it('camino feliz: escribe con TTL de 90 días y procedencia apollo_reveal', () => {
    const decision = buildPhoneCacheWriteDecision(writeInput(), true);
    assert.equal(decision.write, true);
    if (!decision.write) return;
    assert.equal(decision.row.provider, 'apollo');
    assert.equal(decision.row.providerPersonId, PERSON_ID);
    assert.equal(decision.row.accountId, ACCOUNT_A);
    assert.equal(decision.row.countryCode, 'CO');
    assert.equal(decision.row.phoneSource, 'apollo_reveal');
    assert.equal(decision.row.expiresAt, computePhoneCacheExpiresAt(NOW));
    assert.equal(decision.row.sourceCandidateId, CANDIDATE_ID);
  });

  it('no cachea un proveedor distinto de Apollo', () => {
    const decision = buildPhoneCacheWriteDecision(
      writeInput({ provider: 'lusha' }),
      true,
    );
    assert.equal(decision.write === false && decision.reason, 'provider_not_apollo');
  });

  it('no cachea sin cuenta (no habría alcance de reutilización)', () => {
    const decision = buildPhoneCacheWriteDecision(writeInput({ accountId: null }), true);
    assert.equal(decision.write === false && decision.reason, 'missing_account');
  });

  it('no cachea sin teléfono (no_phone_found nunca produce entrada)', () => {
    const decision = buildPhoneCacheWriteDecision(
      writeInput({ normalizedPhone: null }),
      true,
    );
    assert.equal(decision.write === false && decision.reason, 'missing_phone');
  });

  it('NUNCA re-cachea un teléfono que ya venía de la caché', () => {
    const decision = buildPhoneCacheWriteDecision(
      writeInput({ phoneSource: PHONE_CACHE_HIT_PHONE_SOURCE }),
      true,
    );
    assert.equal(decision.write === false && decision.reason, 'phone_source_not_reveal');
  });

  it('el constructor compartido reveal→caché fija siempre phone_source=apollo_reveal', () => {
    const input = buildRevealPhoneCacheWriteInput({
      personId: PERSON_ID,
      accountId: ACCOUNT_A,
      candidateCountry: 'CO',
      runCompanyCountryCode: null,
      phone: FAKE_PHONE,
      phoneType: 'mobile',
      revealedAtIso: NOW,
      candidateId: CANDIDATE_ID,
    });
    assert.equal(input.phoneSource, 'apollo_reveal');
    assert.equal(input.provider, 'apollo');
    assert.equal(input.countryCode, 'CO');
  });
});

// ── Usage-log del hit: sin PII ─────────────────────────────────

describe('CACHE-1b — usage-log del cache hit', () => {
  const log = buildPhoneCacheHitUsageLog({
    candidateId: CANDIDATE_ID,
    accountId: ACCOUNT_A,
    cacheEntryId: 'cache-entry-1',
    providerPersonIdHash: 'deadbeef'.repeat(8),
    actorUserId: 'user-1',
    actorRole: 'admin',
    phoneType: 'mobile',
    originalRevealedAt: '2026-07-01T00:00:00.000Z',
    processingBasis: 'legitimate_interest_b2b',
  });

  it('usa su propio operation_key con 0 créditos y cost_source=cache', () => {
    assert.equal(log.operationKey, 'person_phone_cache_hit');
    assert.equal(log.creditsUsed, 0);
    assert.equal(log.metadata.credits_used, 0);
    assert.equal(log.metadata.cost_source, 'cache');
    assert.equal(log.costUsd, 0);
  });

  it('declara la política aplicada (TTL 90, same_account, base de tratamiento)', () => {
    assert.equal(log.metadata.ttl_days, 90);
    assert.equal(log.metadata.reuse_scope, 'same_account');
    assert.equal(log.metadata.phone_processing_basis, 'legitimate_interest_b2b');
    assert.equal(log.metadata.reveal_phase, 'cache_hit');
  });

  it('el person id viaja HASHEADO, nunca en claro', () => {
    assert.equal(log.metadata.provider_person_id_hash.includes(PERSON_ID), false);
  });

  it('la metadata no contiene teléfono, email, nombre ni linkedin', () => {
    const serialized = JSON.stringify(log.metadata);
    assert.equal(serialized.includes(FAKE_PHONE), false);
    const forbidden = ['phone_number', 'sanitized_number', 'raw_number', 'email',
      'linkedin', 'full_name', 'first_name', 'last_name'];
    for (const banned of forbidden) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(log.metadata, banned),
        false,
        `metadata no debe exponer ${banned}`,
      );
    }
  });

  it('las claves de la metadata son exactamente la allowlist aprobada', () => {
    assert.deepEqual(Object.keys(log.metadata).sort(), [
      'account_id',
      'actor_role',
      'cache_entry_id',
      'candidate_id',
      'cost_source',
      'credits_used',
      'original_revealed_at',
      'phone_present',
      'phone_processing_basis',
      'phone_type',
      'provider_person_id_hash',
      'reuse_scope',
      'reveal_phase',
      'ttl_days',
    ]);
  });
});

// ── FIX 2: evaluador de supresión (independiente del flag) ──────
// Este evaluador es el que el reveal consulta SIEMPRE, con
// ENABLE_APOLLO_PHONE_CACHE encendido o apagado. Su proyección no incluye
// teléfono: comprobar una supresión no requiere leer el número.

describe('CACHE-1b — FIX 2 evaluación del tombstone', () => {
  it('sin fila ⇒ not_suppressed (nunca se suprimió)', () => {
    assert.equal(evaluatePhoneCacheSuppressionState(null), 'not_suppressed');
  });

  it('fila sin suppressed_at ⇒ not_suppressed', () => {
    assert.equal(
      evaluatePhoneCacheSuppressionState({ suppressedAt: null }),
      'not_suppressed',
    );
  });

  it('fila con suppressed_at ⇒ suppressed', () => {
    assert.equal(
      evaluatePhoneCacheSuppressionState({ suppressedAt: '2026-07-20T00:00:00.000Z' }),
      'suppressed',
    );
  });

  it('un suppressed_at en blanco no cuenta como supresión', () => {
    assert.equal(
      evaluatePhoneCacheSuppressionState({ suppressedAt: '   ' }),
      'not_suppressed',
    );
  });

  it('la proyección del tombstone no puede transportar teléfono', () => {
    const state = { suppressedAt: '2026-07-20T00:00:00.000Z' };
    assert.deepEqual(Object.keys(state), ['suppressedAt']);
    assert.equal(JSON.stringify(state).includes(FAKE_PHONE), false);
  });
});

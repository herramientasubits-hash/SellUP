/**
 * Agente 2A — Apollo Phone Cache FAST PATH (APOLLO-PHONE-CACHE-1b)
 *
 * Pruebas offline/DI del fast path de caché dentro del core puro
 * `runRevealCandidatePhone`. Todas las dependencias (flag de reveal, flag de
 * caché, actor, candidato, do_not_contact, START de Apollo, persistencia,
 * usage-log, store de caché) se inyectan y se capturan en memoria: cero red,
 * cero Supabase, cero llamadas a proveedor.
 *
 * Invariante central que estas pruebas protegen: **un cache hit NUNCA llama a
 * Apollo**, y **con el flag de caché apagado NUNCA se lee ni se escribe caché**,
 * de modo que el camino Apollo previo a este hito queda intacto.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runRevealCandidatePhone,
  type ApolloPhoneRevealStartCallResult,
  type PhoneRevealUsageLogEntry,
  type RevealCacheHitPersistencePatch,
  type RevealCandidatePhoneDeps,
  type RevealCandidatePhoneInput,
  type RevealCandidateRecord,
  type RevealStartPersistencePatch,
} from '../phone-reveal-core';
import type {
  PhoneCacheEntry,
  PhoneCacheHitUsageLogEntry,
  PhoneCacheLookupKey,
} from '../phone-cache-core';
import type { MatchPersonParams } from '@/server/integrations/apollo-client';

// ── Fixtures ───────────────────────────────────────────────────

const NOW = '2026-07-29T12:00:00.000Z';
const PERSON_ID = '6a6826ba804c600014ead739';
const LUSHA_ID = 'v1.abcdefghijklmnop';
const ACCOUNT_A = 'acct-aaaa-1111';
const ACCOUNT_B = 'acct-bbbb-2222';
const CANDIDATE_ID = 'cand-0001';
/** Teléfono ficticio de prueba. Nunca un número real. */
const FAKE_PHONE = '+570000000000';
const WEBHOOK_URL = 'https://app.example.com/api/hook?token=secret';
const HTTP_REQUEST_ID = '-4594297923800105423';

function candidate(
  overrides: Partial<RevealCandidateRecord> = {},
): RevealCandidateRecord {
  return {
    id: CANDIDATE_ID,
    accountId: ACCOUNT_A,
    source: 'apollo',
    sourceContactId: PERSON_ID,
    email: 'contacto@empresa-ejemplo.test',
    linkedinUrl: null,
    firstName: 'Nombre',
    lastName: 'Apellido',
    organizationName: 'Empresa Ejemplo',
    existingPhone: null,
    enrichmentMetadata: { relevance: { score: 0.9 } } as never,
    phoneRevealStatus: null,
    phoneRevealAttemptCount: 0,
    apolloPersonId: PERSON_ID,
    candidateCountry: 'CO',
    runCompanyCountryCode: 'CO',
    ...overrides,
  };
}

function cacheEntry(overrides: Partial<PhoneCacheEntry> = {}): PhoneCacheEntry {
  return {
    id: 'cache-entry-1',
    provider: 'apollo',
    providerPersonId: PERSON_ID,
    accountId: ACCOUNT_A,
    countryCode: 'CO',
    normalizedPhone: FAKE_PHONE,
    phoneType: 'mobile',
    phoneSource: 'apollo_reveal',
    originalRevealedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-09-29T00:00:00.000Z',
    hitCount: 3,
    suppressedAt: null,
    ...overrides,
  };
}

const VALID_INPUT: RevealCandidatePhoneInput = {
  candidateId: CANDIDATE_ID,
  confirmCost: true,
  phoneProcessingBasis: 'legitimate_interest_b2b',
};

// ── Captura de efectos ─────────────────────────────────────────

interface Captured {
  apolloCalls: MatchPersonParams[];
  cacheLookups: PhoneCacheLookupKey[];
  cacheHitPatches: RevealCacheHitPersistencePatch[];
  cacheHitLogs: PhoneCacheHitUsageLogEntry[];
  touches: Array<{ entryId: string; usedAt: string }>;
  startPatches: RevealStartPersistencePatch[];
  startLogs: PhoneRevealUsageLogEntry[];
}

let captured: Captured;

beforeEach(() => {
  captured = {
    apolloCalls: [],
    cacheLookups: [],
    cacheHitPatches: [],
    cacheHitLogs: [],
    touches: [],
    startPatches: [],
    startLogs: [],
  };
});

function deps(
  overrides: Partial<RevealCandidatePhoneDeps> = {},
  record: RevealCandidateRecord = candidate(),
  entryInCache: PhoneCacheEntry | null = cacheEntry(),
): RevealCandidatePhoneDeps {
  return {
    flagEnabled: true,
    actor: { internalUserId: 'user-admin-1', roleKey: 'admin' },
    nowIso: NOW,
    webhookUrl: WEBHOOK_URL,
    loadCandidate: async () => record,
    isDoNotContact: async () => false,
    startRevealViaApollo: async (
      params,
    ): Promise<ApolloPhoneRevealStartCallResult> => {
      captured.apolloCalls.push(params);
      return {
        ok: true,
        requestId: 'apollo-req-123',
        trace: {
          apollo_http_request_id: HTTP_REQUEST_ID,
        } as never,
      };
    },
    persist: async (_id, patch) => {
      captured.startPatches.push(patch);
    },
    logUsage: async (entry) => {
      captured.startLogs.push(entry);
    },
    cacheEnabled: true,
    lookupPhoneCache: async (key) => {
      captured.cacheLookups.push(key);
      return entryInCache;
    },
    persistCacheHit: async (_id, patch) => {
      captured.cacheHitPatches.push(patch);
    },
    logCacheHitUsage: async (entry) => {
      captured.cacheHitLogs.push(entry);
    },
    touchPhoneCacheEntry: async (entryId, usedAt) => {
      captured.touches.push({ entryId, usedAt });
    },
    hashProviderPersonId: (id) => `hash(${id.length})`,
    ...overrides,
  };
}

// ── 1. Flag OFF ────────────────────────────────────────────────

describe('CACHE-1b fast path — flag de caché APAGADO', () => {
  it('no lee caché y sigue el camino Apollo normal', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({ cacheEnabled: false }),
    );
    assert.equal(result.status, 'requested');
    assert.equal(captured.cacheLookups.length, 0);
    assert.equal(captured.cacheHitPatches.length, 0);
    assert.equal(captured.cacheHitLogs.length, 0);
    assert.equal(captured.apolloCalls.length, 1);
  });

  it('con `cacheEnabled` sin definir tampoco toca la caché', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({ cacheEnabled: undefined }),
    );
    assert.equal(result.status, 'requested');
    assert.equal(captured.cacheLookups.length, 0);
  });

  it('sin deps de caché cableadas no se rompe: reveal Apollo normal', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({
        lookupPhoneCache: undefined,
        persistCacheHit: undefined,
        logCacheHitUsage: undefined,
      }),
    );
    assert.equal(result.status, 'requested');
    assert.equal(captured.apolloCalls.length, 1);
  });

  it('el flag de reveal apagado corta antes que todo (ni caché ni Apollo)', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({ flagEnabled: false }),
    );
    assert.equal(result.status, 'disabled');
    assert.equal(captured.cacheLookups.length, 0);
    assert.equal(captured.apolloCalls.length, 0);
  });
});

// ── 2. Cache hit ───────────────────────────────────────────────

describe('CACHE-1b fast path — cache HIT', () => {
  it('NO llama a Apollo', async () => {
    const result = await runRevealCandidatePhone(VALID_INPUT, deps());
    assert.equal(result.status, 'revealed_from_cache');
    assert.equal(result.servedFromCache, true);
    assert.equal(captured.apolloCalls.length, 0);
    assert.equal(captured.startPatches.length, 0);
  });

  it('persiste el teléfono con procedencia apollo_cache y estado revealed', async () => {
    await runRevealCandidatePhone(VALID_INPUT, deps());
    const patch = captured.cacheHitPatches[0];
    assert.ok(patch);
    assert.equal(patch.phone, FAKE_PHONE);
    assert.equal(patch.phone_reveal_status, 'revealed');
    assert.equal(patch.phone_reveal_provider, 'apollo');
    assert.equal(patch.enrichment_metadata.phone?.source, 'apollo_cache');
    assert.notEqual(patch.enrichment_metadata.phone?.source, 'apollo_reveal');
  });

  it('cuesta 0 créditos (no hubo llamada al proveedor)', async () => {
    await runRevealCandidatePhone(VALID_INPUT, deps());
    assert.equal(captured.cacheHitPatches[0]?.phone_reveal_cost_credits, 0);
    assert.equal(captured.cacheHitPatches[0]?.phone_reveal_cost_usd, 0);
    assert.equal(captured.cacheHitLogs[0]?.creditsUsed, 0);
  });

  it('registra la base de tratamiento del operador en el candidato y en el log', async () => {
    await runRevealCandidatePhone(VALID_INPUT, deps());
    assert.equal(
      captured.cacheHitPatches[0]?.phone_processing_basis,
      'legitimate_interest_b2b',
    );
    assert.equal(
      captured.cacheHitLogs[0]?.metadata.phone_processing_basis,
      'legitimate_interest_b2b',
    );
  });

  it('emite un usage-log person_phone_cache_hit (no person_phone_reveal)', async () => {
    await runRevealCandidatePhone(VALID_INPUT, deps());
    assert.equal(captured.cacheHitLogs.length, 1);
    assert.equal(captured.cacheHitLogs[0]?.operationKey, 'person_phone_cache_hit');
    assert.equal(captured.startLogs.length, 0);
  });

  it('actualiza la telemetría de reutilización sin extender el TTL', async () => {
    await runRevealCandidatePhone(VALID_INPUT, deps());
    assert.deepEqual(captured.touches, [{ entryId: 'cache-entry-1', usedAt: NOW }]);
    // El patch del candidato no toca expires_at ni ninguna fecha de la caché.
    const serialized = JSON.stringify(captured.cacheHitPatches[0]);
    assert.equal(serialized.includes('expires_at'), false);
  });

  it('un fallo de telemetría no invalida el hit ya persistido', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({
        touchPhoneCacheEntry: async () => {
          throw new Error('telemetry down');
        },
      }),
    );
    assert.equal(result.status, 'revealed_from_cache');
    assert.equal(captured.cacheHitPatches.length, 1);
  });

  it('el resultado NUNCA transporta el teléfono', async () => {
    const result = await runRevealCandidatePhone(VALID_INPUT, deps());
    assert.equal(JSON.stringify(result).includes(FAKE_PHONE), false);
  });

  it('el usage-log del hit no contiene PII', async () => {
    await runRevealCandidatePhone(VALID_INPUT, deps());
    const serialized = JSON.stringify(captured.cacheHitLogs[0]);
    assert.equal(serialized.includes(FAKE_PHONE), false);
    assert.equal(serialized.includes('contacto@empresa-ejemplo.test'), false);
    assert.equal(serialized.includes('Apellido'), false);
    assert.equal(serialized.includes(PERSON_ID), false);
  });
});

// ── 3. Cache miss ──────────────────────────────────────────────

describe('CACHE-1b fast path — cache MISS', () => {
  it('sin entrada continúa con el reveal Apollo asíncrono normal', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({}, candidate(), null),
    );
    assert.equal(result.status, 'requested');
    assert.equal(captured.apolloCalls.length, 1);
    assert.equal(captured.cacheHitPatches.length, 0);
  });

  it('entrada EXPIRADA es miss: no sirve teléfono y llama a Apollo', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({}, candidate(), cacheEntry({ expiresAt: '2026-07-01T00:00:00.000Z' })),
    );
    assert.equal(result.status, 'requested');
    assert.equal(captured.cacheHitPatches.length, 0);
    assert.equal(captured.apolloCalls.length, 1);
  });

  it('CROSS-ACCOUNT no reutiliza: entrada de otra cuenta ⇒ Apollo', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({}, candidate(), cacheEntry({ accountId: ACCOUNT_B })),
    );
    assert.equal(result.status, 'requested');
    assert.equal(captured.cacheHitPatches.length, 0);
    // La búsqueda siempre se hace con la cuenta del candidato: nunca con otra.
    assert.equal(captured.cacheLookups[0]?.accountId, ACCOUNT_A);
  });

  it('CROSS-COUNTRY no reutiliza: entrada de otro país ⇒ Apollo', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({}, candidate(), cacheEntry({ countryCode: 'MX' })),
    );
    assert.equal(result.status, 'requested');
    assert.equal(captured.cacheHitPatches.length, 0);
  });

  it('PAÍS DESCONOCIDO: ni siquiera se consulta la caché', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({}, candidate({ candidateCountry: 'Colombia', runCompanyCountryCode: null })),
    );
    assert.equal(result.status, 'requested');
    assert.equal(captured.cacheLookups.length, 0);
    assert.equal(captured.cacheHitPatches.length, 0);
  });

  it('SIN CUENTA: ni siquiera se consulta la caché', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({}, candidate({ accountId: null })),
    );
    assert.equal(result.status, 'requested');
    assert.equal(captured.cacheLookups.length, 0);
  });

  it('ID LUSHA `v1.*`: no se lee caché en absoluto', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps(
        {},
        candidate({
          apolloPersonId: LUSHA_ID,
          source: 'lusha',
          sourceContactId: LUSHA_ID,
        }),
      ),
    );
    assert.equal(result.status, 'requested');
    assert.equal(captured.cacheLookups.length, 0);
  });

  it('la clave de búsqueda siempre lleva provider/persona/cuenta/país', async () => {
    await runRevealCandidatePhone(VALID_INPUT, deps({}, candidate(), null));
    assert.deepEqual(captured.cacheLookups[0], {
      provider: 'apollo',
      providerPersonId: PERSON_ID,
      accountId: ACCOUNT_A,
      countryCode: 'CO',
    });
  });
});

// ── 4. Tombstone ───────────────────────────────────────────────

describe('CACHE-1b fast path — tombstone / supresión', () => {
  const suppressed = cacheEntry({
    normalizedPhone: null,
    phoneType: null,
    suppressedAt: '2026-07-20T00:00:00.000Z',
  });

  it('bloquea el reveal automático y NO llama a Apollo', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({}, candidate(), suppressed),
    );
    assert.equal(result.status, 'blocked_suppressed');
    assert.equal(result.ok, false);
    assert.equal(captured.apolloCalls.length, 0);
  });

  it('no devuelve teléfono ni persiste nada', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({}, candidate(), suppressed),
    );
    assert.equal(JSON.stringify(result).includes(FAKE_PHONE), false);
    assert.equal(captured.cacheHitPatches.length, 0);
    assert.equal(captured.startPatches.length, 0);
  });
});

// ── 5. Gates previos: rol y base de tratamiento ────────────────

describe('CACHE-1b fast path — gates heredados del reveal', () => {
  it('seller_bd NO puede usar el cache hit (mismo gate de rol)', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({ actor: { internalUserId: 'user-bd', roleKey: 'seller_bd' } }),
    );
    assert.equal(result.status, 'unauthorized_role');
    assert.equal(captured.cacheLookups.length, 0);
    assert.equal(captured.cacheHitPatches.length, 0);
  });

  it('commercial_manager SÍ puede usar el cache hit (rol heredado del reveal)', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({ actor: { internalUserId: 'user-cm', roleKey: 'commercial_manager' } }),
    );
    assert.equal(result.status, 'revealed_from_cache');
    assert.equal(captured.cacheHitLogs[0]?.metadata.actor_role, 'commercial_manager');
  });

  it('sin base de tratamiento no hay cache hit', async () => {
    const result = await runRevealCandidatePhone(
      { ...VALID_INPUT, phoneProcessingBasis: null },
      deps(),
    );
    assert.equal(result.status, 'processing_basis_required');
    assert.equal(captured.cacheLookups.length, 0);
  });

  it('other_approved_basis sin nota bloquea también el cache hit', async () => {
    const result = await runRevealCandidatePhone(
      { ...VALID_INPUT, phoneProcessingBasis: 'other_approved_basis' },
      deps(),
    );
    assert.equal(result.status, 'processing_basis_note_required');
    assert.equal(captured.cacheLookups.length, 0);
  });

  it('sin confirmación de costo no hay cache hit', async () => {
    const result = await runRevealCandidatePhone(
      { ...VALID_INPUT, confirmCost: false },
      deps(),
    );
    assert.equal(result.status, 'cost_confirmation_required');
    assert.equal(captured.cacheLookups.length, 0);
  });

  it('do_not_contact bloquea antes de consultar la caché', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({ isDoNotContact: async () => true }),
    );
    assert.equal(result.status, 'do_not_contact');
    assert.equal(captured.cacheLookups.length, 0);
  });

  it('un teléfono ya servido desde caché bloquea un segundo reveal', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps(
        {},
        candidate({
          enrichmentMetadata: {
            phone: { number: FAKE_PHONE, type: 'mobile', source: 'apollo_cache' },
          } as never,
        }),
      ),
    );
    assert.equal(result.status, 'already_revealed');
    assert.equal(captured.cacheLookups.length, 0);
    assert.equal(captured.apolloCalls.length, 0);
  });
});

// ── 6. FIX H4: la búsqueda de caché falla ──────────────────────
// Si la lectura de caché lanza (tabla ausente, timeout, error de Postgres) NO se
// puede degradar a "miss" y llamar a Apollo: podría existir un tombstone de
// supresión no visto, así que revelar de nuevo violaría la supresión además de
// gastar créditos. El resultado es un estado seguro y reintentable.

describe('CACHE-1b fast path — FIX H4 la caché no está disponible', () => {
  const boom = async (): Promise<never> => {
    throw new Error('relation "phone_reveal_cache" does not exist');
  };

  it('no lanza: devuelve el estado seguro cache_unavailable', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({ lookupPhoneCache: boom }),
    );
    assert.equal(result.status, 'cache_unavailable');
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'cache_unavailable');
    assert.equal(result.servedFromCache, false);
  });

  it('NO llama a Apollo (fail-closed: podría haber una supresión no vista)', async () => {
    await runRevealCandidatePhone(VALID_INPUT, deps({ lookupPhoneCache: boom }));
    assert.equal(captured.apolloCalls.length, 0);
  });

  it('no consume créditos, no persiste y no revela teléfono', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({ lookupPhoneCache: boom }),
    );
    assert.equal(captured.cacheHitPatches.length, 0);
    assert.equal(captured.cacheHitLogs.length, 0);
    assert.equal(captured.startPatches.length, 0);
    assert.equal(captured.startLogs.length, 0);
    assert.equal(captured.touches.length, 0);
    assert.equal(JSON.stringify(result).includes(FAKE_PHONE), false);
  });

  it('notifica el fallo con el mensaje del driver y SIN PII', async () => {
    const notified: string[] = [];
    await runRevealCandidatePhone(
      VALID_INPUT,
      deps({
        lookupPhoneCache: boom,
        onCacheLookupUnavailable: (message) => notified.push(message),
      }),
    );
    assert.equal(notified.length, 1);
    const message = notified[0] ?? '';
    for (const banned of [FAKE_PHONE, PERSON_ID, 'contacto@empresa-ejemplo.test']) {
      assert.equal(message.includes(banned), false, `el log no debe incluir ${banned}`);
    }
  });

  it('sin notificador cableado tampoco lanza', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({ lookupPhoneCache: boom, onCacheLookupUnavailable: undefined }),
    );
    assert.equal(result.status, 'cache_unavailable');
    assert.equal(captured.apolloCalls.length, 0);
  });

  it('con el flag de caché APAGADO un fallo de caché es imposible: reveal normal', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      deps({ cacheEnabled: false, lookupPhoneCache: boom }),
    );
    assert.equal(result.status, 'requested');
    assert.equal(captured.apolloCalls.length, 1);
  });
});

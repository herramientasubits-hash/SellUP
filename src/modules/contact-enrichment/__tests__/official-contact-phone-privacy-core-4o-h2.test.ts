/**
 * Agente 2A — contrato PURO de la privacidad del modelo OFICIAL de múltiples teléfonos
 * (AGENT2A-PHONE-REVEAL-4O-H2).
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ FIJA ESTA SUITE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * que la SUPRIMIBILIDAD se DERIVA y no se inventa: el par
 *     `(provider, acquisition_mode)` se traduce con el mapeo de la 112 y se pregunta a la
 *     allowlist de 4O-E4. `manual`, `unknown` y `(apollo, search)` sobreviven, y sobreviven
 *     porque la composición lo dice — no porque alguien los listara aparte;
 *   * que los vocabularios son ESPEJO de los CHECK de la 114 en AMBAS direcciones, para que un
 *     valor no pueda añadirse en un solo lado y producir un 23514 en ejecución (el defecto de
 *     #238);
 *   * que el parser del sobre es FAIL-CLOSED: lanza en vez de degradar a «0 filas»;
 *   * que `officialContactTargets` es MÁS ANCHO que `contactPatches`, que es la propiedad de
 *     privacidad que impide que un número manual proteja por accidente filas oficiales de
 *     Apollo ya pagadas.
 *
 * Estas pruebas son puras: no tocan la red, ni Supabase, ni PostgreSQL, ni Producción; no
 * llaman a ningún proveedor y no gastan un crédito. Las GARANTÍAS transaccionales —tombstone,
 * último-origen, reelección, sincronización del escalar, concurrencia, privilegios— son
 * propiedades de PostgreSQL y se miden en la suite hermana `…-postgres-4o-h2`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOfficialPhoneSuppressionParams,
  deriveLegacyPhoneSource,
  DSAR_OFFICIAL_PHONE_SUPPRESSION_SCOPE,
  isSuppressibleOfficialPhoneSource,
  OFFICIAL_PHONE_ACQUISITION_MODES,
  OFFICIAL_PHONE_PROVIDERS,
  OFFICIAL_PHONE_SETTLED_STATUSES,
  OFFICIAL_PHONE_SUPPRESSION_SCOPES,
  OFFICIAL_PHONE_SUPPRESSION_STATUSES,
  parseOfficialPhoneSuppressionEnvelope,
  suppressibleOfficialSourcePairs,
  SUPPRESS_OFFICIAL_CONTACT_PHONE_SOURCES_FN,
} from '../official-contact-phone-suppression-core';
import {
  CANDIDATE_PHONE_ACQUISITION_MODES,
  CANDIDATE_PHONE_PROVIDERS,
} from '../phone-collection-core';
import {
  buildPhoneCacheSuppressionPlan,
  SUPPRESSIBLE_CONTACT_PHONE_SOURCES,
  type SuppressibleCandidate,
  type SuppressibleContact,
} from '../phone-cache-suppression-core';

const NOW = '2026-08-11T12:00:00.000Z';

// ═══════════════════════════════════════════════════════════════════
// Vocabularios — espejo de la 114 en AMBAS direcciones
// ═══════════════════════════════════════════════════════════════════

describe('4O-H2 — vocabularios', () => {
  it('el proveedor oficial es EXACTAMENTE el de la colección del candidato (109/114)', () => {
    // La 114 reutilizó el vocabulario de la 109 carácter por carácter. Si una de las dos
    // listas ganara un miembro, el par dejaría de ser traducible y la CHECK lo rechazaría en
    // ejecución en vez de en la revisión.
    assert.deepEqual(
      [...OFFICIAL_PHONE_PROVIDERS].sort(),
      [...CANDIDATE_PHONE_PROVIDERS].sort(),
    );
  });

  it('el modo de adquisición oficial es EXACTAMENTE el de la 109/114', () => {
    assert.deepEqual(
      [...OFFICIAL_PHONE_ACQUISITION_MODES].sort(),
      [...CANDIDATE_PHONE_ACQUISITION_MODES].sort(),
    );
  });

  it('el nombre de la función es un literal y no una plantilla', () => {
    assert.equal(
      SUPPRESS_OFFICIAL_CONTACT_PHONE_SOURCES_FN,
      'suppress_official_contact_phone_sources',
    );
  });

  it('la DSAR cableada usa el alcance de PERSONA, no el de un proveedor', () => {
    // Cablearla a `single_provider` habría dejado viva la procedencia de Lusha y con ella el
    // número canónico, mientras el escalar heredado quedaba limpio a su lado.
    assert.equal(DSAR_OFFICIAL_PHONE_SUPPRESSION_SCOPE, 'all_suppressible_providers');
    assert.ok(
      OFFICIAL_PHONE_SUPPRESSION_SCOPES.includes(
        DSAR_OFFICIAL_PHONE_SUPPRESSION_SCOPE,
      ),
    );
  });

  it('`no_official_collection` LIQUIDA, y los dos fallos NO', () => {
    // Es la clave de la inercia en Producción: no había colección, así que no hay nada a
    // medias. `contact_not_found` e `invalid_input` no pueden liquidar nunca — reportarlos
    // como éxito sería exactamente el false success que §38 prohíbe.
    assert.deepEqual([...OFFICIAL_PHONE_SETTLED_STATUSES].sort(), [
      'already_suppressed',
      'no_official_collection',
      'suppressed',
    ]);
    for (const status of ['contact_not_found', 'invalid_input'] as const) {
      assert.ok(OFFICIAL_PHONE_SUPPRESSION_STATUSES.includes(status));
      assert.equal(
        (OFFICIAL_PHONE_SETTLED_STATUSES as readonly string[]).includes(status),
        false,
        `${status} no puede contar como liquidado`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Suprimibilidad DERIVADA
// ═══════════════════════════════════════════════════════════════════

describe('4O-H2 — la suprimibilidad se DERIVA de la 112 + la allowlist de 4O-E4', () => {
  it('el mapeo par → escalar heredado es el `CASE` de la 112', () => {
    assert.equal(deriveLegacyPhoneSource('apollo', 'reveal'), 'apollo_reveal');
    assert.equal(deriveLegacyPhoneSource('apollo', 'waterfall'), 'apollo_reveal');
    assert.equal(deriveLegacyPhoneSource('apollo', 'search'), 'apollo_search');
    assert.equal(deriveLegacyPhoneSource('apollo_cache', 'cache'), 'apollo_cache');
    assert.equal(deriveLegacyPhoneSource('lusha', 'reveal'), 'lusha_reveal');
    assert.equal(deriveLegacyPhoneSource('manual', 'manual'), 'manual');
    assert.equal(deriveLegacyPhoneSource('unknown', 'search'), 'unknown');
    // `apollo` con un modo que la 112 no contempla cae a `unknown`, que es una afirmación
    // verdadera sobre lo que SellUp sabe y un miembro existente del vocabulario.
    assert.equal(deriveLegacyPhoneSource('apollo', 'cache'), 'unknown');
    assert.equal(deriveLegacyPhoneSource('apollo', 'manual'), 'unknown');
  });

  it('`apollo_cache` y `lusha` se deciden SÓLO por el proveedor', () => {
    // El orden de las ramas del `CASE` importa: si `lusha` consultara el modo, un
    // `(lusha, cache)` legítimo dejaría de ser suprimible y el número sobreviviría a la DSAR.
    for (const mode of OFFICIAL_PHONE_ACQUISITION_MODES) {
      assert.equal(deriveLegacyPhoneSource('lusha', mode), 'lusha_reveal');
      assert.equal(deriveLegacyPhoneSource('apollo_cache', mode), 'apollo_cache');
    }
  });

  it('el conjunto suprimible es la COMPOSICIÓN, no una segunda lista', () => {
    // La propiedad, no la enumeración: para TODO par representable, ser suprimible equivale a
    // que su valor derivado esté en la allowlist heredada. Una allowlist duplicada es la forma
    // en que dos capas empiezan a discrepar sobre qué es borrable.
    for (const provider of OFFICIAL_PHONE_PROVIDERS) {
      for (const acquisitionMode of OFFICIAL_PHONE_ACQUISITION_MODES) {
        assert.equal(
          isSuppressibleOfficialPhoneSource(provider, acquisitionMode),
          SUPPRESSIBLE_CONTACT_PHONE_SOURCES.includes(
            deriveLegacyPhoneSource(provider, acquisitionMode),
          ),
          `(${provider}, ${acquisitionMode}) discrepa entre la composición y la allowlist`,
        );
      }
    }
  });

  it('MANUAL sobrevive a Apollo Y a Lusha, en todos sus modos', () => {
    // Una DSAR dirigida a un proveedor no tiene autoridad sobre evidencia que escribió una
    // persona. Es «FIX M1» de 4O-E4 aplicado al modelo oficial.
    for (const mode of OFFICIAL_PHONE_ACQUISITION_MODES) {
      assert.equal(
        isSuppressibleOfficialPhoneSource('manual', mode),
        false,
        `(manual, ${mode}) NO puede ser suprimible`,
      );
    }
  });

  it('UNKNOWN sobrevive: nadie puede AFIRMAR que era de Apollo', () => {
    // Para una AUTORIDAD de borrado, fail-closed es borrar MENOS: atribuir una procedencia sin
    // atribuir a un proveedor concreto sería una conjetura ejecutada como un hecho.
    for (const mode of OFFICIAL_PHONE_ACQUISITION_MODES) {
      assert.equal(isSuppressibleOfficialPhoneSource('unknown', mode), false);
    }
  });

  it('`(apollo, search)` sobrevive a una supresión de Apollo — DECLARADO', () => {
    // No es un olvido: el contrato heredado nunca autorizó destruir un escalar
    // `apollo_search`, y ensanchar el radio de una DSAR de camino al modelo oficial sería
    // inventarse una autoridad que nadie concedió. Si se revisa, se revisa en la allowlist.
    assert.equal(isSuppressibleOfficialPhoneSource('apollo', 'search'), false);
    assert.equal(
      SUPPRESSIBLE_CONTACT_PHONE_SOURCES.includes('apollo_search'),
      false,
      'el día que la allowlist admita apollo_search, las dos capas se mueven juntas',
    );
  });

  it('el conjunto suprimible enumerado es EXACTAMENTE el esperado', () => {
    // Se fija la enumeración además de la propiedad: es lo que el `WHERE` de la 115 tiene que
    // reproducir, y la suite estática compara las dos direcciones contra el SQL.
    assert.deepEqual(
      suppressibleOfficialSourcePairs()
        .map((pair) => `${pair.provider}:${pair.acquisitionMode}`)
        .sort(),
      [
        'apollo:reveal',
        'apollo:waterfall',
        'apollo_cache:cache',
        'apollo_cache:manual',
        'apollo_cache:reveal',
        'apollo_cache:search',
        'apollo_cache:waterfall',
        'lusha:cache',
        'lusha:manual',
        'lusha:reveal',
        'lusha:search',
        'lusha:waterfall',
      ],
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Parámetros de la RPC
// ═══════════════════════════════════════════════════════════════════

describe('4O-H2 — parámetros `p_*`', () => {
  const base = {
    contactId: 'c0000000-0000-4000-8000-000000000001',
    dedupeKey: null,
    suppressionReason: 'data_subject_request' as const,
    suppressedBy: 'u0000000-0000-4000-8000-000000000001',
    suppressedAt: NOW,
  };

  it('el alcance de persona manda `p_provider = null`', () => {
    assert.deepEqual(
      buildOfficialPhoneSuppressionParams({
        ...base,
        scope: 'all_suppressible_providers',
        provider: null,
      }),
      {
        p_contact_id: base.contactId,
        p_provider_scope: 'all_suppressible_providers',
        p_provider: null,
        p_dedupe_key: null,
        p_suppression_reason: 'data_subject_request',
        p_suppressed_by: base.suppressedBy,
        p_suppressed_at: NOW,
      },
    );
  });

  it('un proveedor colado junto al alcance de persona NO viaja', () => {
    // La RPC lo rechazaría con `provider_not_allowed`; el builder lo normaliza antes para que
    // el rechazo no dependa de que el llamador se acuerde. Cinturón y tirantes: si el builder
    // dejara pasar el valor, la 115 falla en vez de borrar un alcance que nadie pidió.
    const params = buildOfficialPhoneSuppressionParams({
      ...base,
      scope: 'all_suppressible_providers',
      provider: 'apollo',
    });
    assert.equal(params.p_provider, null);
  });

  it('el alcance de un proveedor SÍ lo propaga', () => {
    const params = buildOfficialPhoneSuppressionParams({
      ...base,
      scope: 'single_provider',
      provider: 'lusha',
    });
    assert.equal(params.p_provider_scope, 'single_provider');
    assert.equal(params.p_provider, 'lusha');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Sobre — FAIL-CLOSED
// ═══════════════════════════════════════════════════════════════════

describe('4O-H2 — el parser del sobre es fail-closed', () => {
  const ok = {
    status: 'suppressed',
    sources_suppressed: 2,
    phones_tombstoned: 1,
    survivor_count: 3,
    primary_dedupe_key: `e164:${'a'.repeat(64)}`,
    primary_changed: true,
    scalar_synced: true,
    scalar_guarded_by_provenance: false,
    contact_settled: true,
  };

  it('lee el sobre completo', () => {
    assert.deepEqual(parseOfficialPhoneSuppressionEnvelope(ok), {
      status: 'suppressed',
      sourcesSuppressed: 2,
      phonesTombstoned: 1,
      survivorCount: 3,
      primaryDedupeKey: `e164:${'a'.repeat(64)}`,
      primaryChanged: true,
      scalarSynced: true,
      scalarGuardedByProvenance: false,
      contactSettled: true,
    });
  });

  it('`no_official_collection` es un resultado válido y LIQUIDA', () => {
    const outcome = parseOfficialPhoneSuppressionEnvelope({
      status: 'no_official_collection',
      sources_suppressed: 0,
      phones_tombstoned: 0,
      survivor_count: 0,
      primary_dedupe_key: null,
      primary_changed: false,
      scalar_synced: false,
      scalar_guarded_by_provenance: false,
      contact_settled: true,
    });
    assert.equal(outcome.status, 'no_official_collection');
    assert.equal(outcome.contactSettled, true);
    assert.equal(outcome.sourcesSuppressed, 0);
  });

  it('LANZA con un sobre que no es objeto', () => {
    for (const bad of [null, undefined, 'suppressed', 7, []] as unknown[]) {
      assert.throws(() => parseOfficialPhoneSuppressionEnvelope(bad));
    }
  });

  it('LANZA sin `status`', () => {
    assert.throws(() => parseOfficialPhoneSuppressionEnvelope({ sources_suppressed: 1 }));
  });

  it('LANZA con `invalid_input` y arrastra el detalle mecánico', () => {
    // Tratarlo como resultado lo dejaría pasar como éxito silencioso: significa que el
    // llamador construyó mal la petición, no que no hubiera nada que borrar.
    assert.throws(
      () =>
        parseOfficialPhoneSuppressionEnvelope({
          status: 'invalid_input',
          detail: 'provider_scope_unknown',
        }),
      /provider_scope_unknown/,
    );
  });

  it('LANZA con un `status` desconocido', () => {
    assert.throws(
      () => parseOfficialPhoneSuppressionEnvelope({ status: 'partially_maybe' }),
      /partially_maybe/,
    );
  });

  it('`contact_settled: true` junto a un estado que NO liquida NO se cree', () => {
    // Fail-open exacto que el cruce impide: el estado es el hecho mecánico y el booleano una
    // conveniencia, así que gana el estado.
    const outcome = parseOfficialPhoneSuppressionEnvelope({
      status: 'contact_not_found',
      contact_settled: true,
    });
    assert.equal(outcome.contactSettled, false);
  });

  it('los conteos ausentes o absurdos leen 0, nunca NaN ni negativo', () => {
    const outcome = parseOfficialPhoneSuppressionEnvelope({
      status: 'already_suppressed',
      sources_suppressed: -4,
      phones_tombstoned: 'dos',
      survivor_count: Number.NaN,
    });
    assert.equal(outcome.sourcesSuppressed, 0);
    assert.equal(outcome.phonesTombstoned, 0);
    assert.equal(outcome.survivorCount, 0);
  });

  it('nunca devuelve un teléfono: `primary_dedupe_key` no numérico se descarta', () => {
    const outcome = parseOfficialPhoneSuppressionEnvelope({
      status: 'suppressed',
      primary_dedupe_key: 12345,
    });
    assert.equal(outcome.primaryDedupeKey, null);
  });
});

// ═══════════════════════════════════════════════════════════════════
// El plan: `officialContactTargets` es MÁS ANCHO que `contactPatches`
// ═══════════════════════════════════════════════════════════════════

describe('4O-H2 — alcance oficial vs alcance del escalar', () => {
  const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
  const CANDIDATE = 'ca000000-0000-4000-8000-000000000001';
  const PERSON_ID = 'a'.repeat(24);

  const candidate = (): SuppressibleCandidate => ({
    id: CANDIDATE,
    accountId: ACCOUNT,
    enrichmentRunId: 'r0000000-0000-4000-8000-000000000001',
    enrichmentMetadata: {},
    createdContactId: null,
    matchedContactId: null,
  });

  const contact = (
    id: string,
    phoneSource: string | null,
    sourceCandidateId: string | null = CANDIDATE,
  ): SuppressibleContact => ({
    id,
    accountId: ACCOUNT,
    sourceCandidateId,
    phoneSource,
  });

  const planFor = (contacts: SuppressibleContact[]) => {
    const result = buildPhoneCacheSuppressionPlan(
      {
        providerPersonId: PERSON_ID,
        accountId: ACCOUNT,
        countryCode: 'CO',
        reason: 'dsar_erasure_request',
        actorRoleKey: 'admin',
        actorUserId: 'u0000000-0000-4000-8000-000000000001',
      },
      { nowIso: NOW, candidates: [candidate()], contacts },
    );
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('unreachable');
    return result.plan;
  };

  it('un contacto MANUAL entra en el alcance OFICIAL y NO en el del escalar', () => {
    // ESTA es la propiedad de privacidad del hito. Un contacto con un número teclado a mano
    // puede tener perfectamente filas oficiales de Apollo ya pagadas sobre el titular de la
    // DSAR. Si la allowlist del escalar decidiera también el alcance oficial, esos números
    // seguirían vivos sólo porque alguien había teclado además un número — un hueco.
    const plan = planFor([contact('c1', 'manual')]);
    assert.deepEqual(plan.contactPatches, []);
    assert.deepEqual(plan.officialContactTargets, [
      { contactId: 'c1', linkStrength: 'provenance_proven' },
    ]);
  });

  it('lo mismo con `unknown`, `apollo_search`, `provider_payload` y NULL', () => {
    const plan = planFor([
      contact('c1', 'unknown'),
      contact('c2', 'apollo_search'),
      contact('c3', 'provider_payload'),
      contact('c4', null),
    ]);
    assert.deepEqual(plan.contactPatches, []);
    assert.deepEqual(
      plan.officialContactTargets.map((t) => t.contactId).sort(),
      ['c1', 'c2', 'c3', 'c4'],
    );
  });

  it('una procedencia suprimible entra en LOS DOS alcances', () => {
    const plan = planFor([contact('c1', 'apollo_reveal')]);
    assert.deepEqual(
      plan.contactPatches.map((p) => p.contactId),
      ['c1'],
    );
    assert.deepEqual(
      plan.officialContactTargets.map((t) => t.contactId),
      ['c1'],
    );
  });

  it('SIN procedencia probada no entra en NINGÚN alcance', () => {
    // La identidad sigue siendo obligatoria: `metadata.source_candidate_id` es la única prueba
    // aceptada, y ensanchar el alcance oficial NO ensancha quién lo autoriza (FIX 1).
    const plan = planFor([
      contact('c1', 'apollo_reveal', null),
      contact('c2', 'apollo_reveal', 'otro-candidato'),
    ]);
    assert.deepEqual(plan.contactPatches, []);
    assert.deepEqual(plan.officialContactTargets, []);
  });

  it('fuera de la cuenta no entra en NINGÚN alcance', () => {
    const plan = planFor([
      { ...contact('c1', 'apollo_reveal'), accountId: 'otra-cuenta' },
      { ...contact('c2', 'manual'), accountId: null },
    ]);
    assert.deepEqual(plan.contactPatches, []);
    assert.deepEqual(plan.officialContactTargets, []);
  });

  it('un contacto repetido produce UN solo objetivo oficial', () => {
    // Dos filas descubiertas por dos caminos (FK y metadata) no pueden convertirse en dos
    // llamadas a la RPC: la segunda sería idempotente, pero los conteos de la auditoría se
    // duplicarían y «cuántas procedencias se retiraron» dejaría de ser verdad.
    const plan = planFor([contact('c1', 'apollo_reveal'), contact('c1', 'apollo_reveal')]);
    assert.equal(plan.officialContactTargets.length, 1);
    assert.equal(plan.contactPatches.length, 1);
  });

  it('el alcance oficial es siempre un SUPERCONJUNTO del alcance del escalar', () => {
    // La invariante, no un caso: si alguna vez se invirtiera, existiría un contacto cuyo
    // escalar se borra mientras su colección oficial conserva el número.
    const plan = planFor([
      contact('c1', 'apollo_reveal'),
      contact('c2', 'manual'),
      contact('c3', 'lusha_reveal'),
      contact('c4', null),
      contact('c5', 'apollo_reveal', null),
    ]);
    const official = new Set(plan.officialContactTargets.map((t) => t.contactId));
    for (const patch of plan.contactPatches) {
      assert.ok(
        official.has(patch.contactId),
        `${patch.contactId} borra el escalar sin entrar en el alcance oficial`,
      );
    }
    assert.ok(official.size >= plan.contactPatches.length);
  });
});

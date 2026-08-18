/**
 * Tests — elegibilidad de IDENTIDAD del reveal de teléfono
 * (Agente 2A · AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-2, RE-ESPECIFICADO en la Fase 1 de
 *  AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4)
 *
 * QUÉ CAMBIÓ, Y POR QUÉ ESTE ARCHIVO SE REESCRIBE EN VEZ DE AJUSTARSE
 *
 * El contrato de #291 era «identidad de Apollo resoluble Y `account_id`». La Fase 1
 * invalida las DOS mitades, así que los casos B (sin cuenta ⇒ bloqueado) y C (candidato
 * Lusha ⇒ bloqueado) no están «rotos»: afirmaban un requisito que el servidor ya no tiene.
 * Dejarlos verdes exigiría conservar en producción justo lo que este hito existe para
 * quitar.
 *
 * El contrato nuevo es una sola condición:
 *
 *     identidad NATIVA del proveedor resoluble
 *
 * Qué se verifica:
 *   * la regla del cliente es la MISMA que la del servidor, comprobada por PARIDAD contra
 *     `resolvePhoneRevealProviderIdentity` —la función que usan START, webhook, recovery y
 *     la puerta previa a Lusha— barriendo la matriz completa, no por una segunda
 *     aproximación escrita a mano;
 *   * identidad de Apollo válida ⇒ `eligible`, CON o SIN cuenta;
 *   * identidad nativa de Lusha (`source === 'lusha'` + `source_contact_id`) ⇒ `eligible`,
 *     CON o SIN cuenta;
 *   * sin NINGUNA identidad nativa ⇒ bloqueado (el único caso que queda);
 *   * la validación de Apollo NO se relajó: un `v1.*` de Lusha sigue sin ser un id de
 *     Apollo, y un `source_contact_id` con forma de Apollo en un candidato NO Apollo sigue
 *     sin reenviarse como identidad de Apollo — ahora se evalúa como identidad de su
 *     propio proveedor cuando ese proveedor tiene supresión propia, y como nada cuando no;
 *   * el copy del bloqueo no nombra proveedor ni promete reintento (sin cambios).
 *
 * Puro y offline: sin red, sin Supabase, sin proveedores, sin reloj.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluatePhoneRevealIdentityEligibility,
  PHONE_REVEAL_IDENTITY_BLOCKED_COPY,
} from '../phone-reveal-identity-eligibility';
import { resolvePhoneRevealProviderIdentity } from '../provider-suppression-core';

const APOLLO_ID = '0123456789abcdef01234567';
const OTHER_APOLLO_ID = 'fedcba9876543210fedcba98';
const LUSHA_ID = 'v1.eyJhIjoiYiIsImMiOiJkIn0';
const ACCOUNT = '11111111-2222-3333-4444-555555555555';

describe('evaluatePhoneRevealIdentityEligibility — casos del contrato', () => {
  it('A. cuenta + identidad Apollo válida ⇒ eligible', () => {
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: APOLLO_ID,
        source: 'apollo',
        sourceContactId: null,
        accountId: ACCOUNT,
      }),
      'eligible',
    );
  });

  // FASE 1 — el caso que define el hito. Antes: `missing_account`.
  it('B. sin cuenta ⇒ ELIGIBLE (la cuenta dejó de ser requisito de privacidad)', () => {
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: APOLLO_ID,
        source: 'apollo',
        sourceContactId: APOLLO_ID,
        accountId: null,
      }),
      'eligible',
    );
  });

  // FASE 1 — una cuenta en blanco tampoco es una cuenta, y eso YA NO IMPORTA: el resultado
  // es el mismo que sin cuenta y que con cuenta válida. Se conserva el caso porque su
  // ausencia dejaría sin cubrir que la función no se rompe ni cambia con basura en ese
  // campo (que ahora ignora por completo).
  it('B bis. una cuenta en blanco es indistinguible de cualquier otra: ELIGIBLE', () => {
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: APOLLO_ID,
        source: 'apollo',
        accountId: '   ',
      }),
      'eligible',
    );
  });

  // FASE 1 — antes: `missing_person_identity`, porque sólo se miraba a Apollo. Ahora el
  // candidato de Lusha tiene identidad NATIVA y por tanto privacidad evaluable.
  it('C. candidato Lusha con su source_contact_id ⇒ ELIGIBLE (identidad nativa de Lusha)', () => {
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: null,
        source: 'lusha',
        sourceContactId: LUSHA_ID,
        accountId: ACCOUNT,
      }),
      'eligible',
    );
  });

  it('C bis. candidato Lusha con su source_contact_id y SIN cuenta ⇒ ELIGIBLE', () => {
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: null,
        source: 'lusha',
        sourceContactId: LUSHA_ID,
        accountId: null,
      }),
      'eligible',
    );
  });

  // El ÚNICO caso de bloqueo que sobrevive: ni identidad de Apollo, ni identidad nativa de
  // un proveedor con supresión propia. Aquí sí falta de verdad la identidad, y por eso el
  // botón sigue deshabilitado con el copy de #291.
  it('D. sin NINGUNA identidad nativa ⇒ missing_person_identity', () => {
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: null,
        source: 'hubspot',
        sourceContactId: null,
        accountId: ACCOUNT,
      }),
      'missing_person_identity',
    );
    // Y tampoco es elegible sin cuenta: la carencia es de identidad, no de cuenta.
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: null,
        source: 'hubspot',
        sourceContactId: null,
        accountId: null,
      }),
      'missing_person_identity',
    );
  });

  // Apollo conserva la PRECEDENCIA: un candidato de Lusha que ADEMÁS lleva un
  // `apollo_person_id` válido se evalúa como Apollo. Eso preserva literalmente la clave con
  // la que se escribieron las supresiones históricas.
  it('E. candidato Lusha con apollo_person_id válido ⇒ eligible (Apollo tiene precedencia)', () => {
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: APOLLO_ID,
        source: 'lusha',
        sourceContactId: LUSHA_ID,
        accountId: ACCOUNT,
      }),
      'eligible',
    );
  });

  it('F. candidato Apollo con source_contact_id válido + cuenta ⇒ eligible sin columna propia', () => {
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: null,
        source: 'apollo',
        sourceContactId: APOLLO_ID,
        accountId: ACCOUNT,
      }),
      'eligible',
    );
  });

  it('G. source_contact_id inválido ⇒ bloqueado, salvo que apollo_person_id sea válido', () => {
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: null,
        source: 'apollo',
        sourceContactId: 'no-es-un-object-id',
        accountId: ACCOUNT,
      }),
      'missing_person_identity',
    );
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: OTHER_APOLLO_ID,
        source: 'apollo',
        sourceContactId: 'no-es-un-object-id',
        accountId: ACCOUNT,
      }),
      'eligible',
    );
  });

  it('G bis. un source_contact_id con forma Apollo en un candidato NO Apollo no se reenvía como Apollo', () => {
    // Espacios de id distintos, y eso NO se relajó: sólo un candidato de origen Apollo
    // puede reenviar su `source_contact_id` como Apollo person id.
    //
    // Lo que cambió es qué pasa después. En un candidato de LUSHA ese mismo valor se
    // evalúa como identidad de LUSHA —su propio espacio de nombres— así que es elegible;
    // en un candidato de un origen SIN supresión propia no hay identidad y sigue
    // bloqueado. En ninguno de los dos casos el valor se convierte en un id de Apollo.
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: null,
        source: 'lusha',
        sourceContactId: APOLLO_ID,
        accountId: ACCOUNT,
      }),
      'eligible',
    );
    assert.equal(
      resolvePhoneRevealProviderIdentity({
        apolloPersonId: null,
        source: 'lusha',
        sourceContactId: APOLLO_ID,
      })?.provider,
      'lusha',
      'se evalúa en el espacio de Lusha, nunca traducido a Apollo',
    );
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: null,
        source: 'hubspot',
        sourceContactId: APOLLO_ID,
        accountId: ACCOUNT,
      }),
      'missing_person_identity',
    );
  });

  it('sin ninguna señal (proyección vacía) ⇒ bloqueado, nunca elegible por defecto', () => {
    assert.equal(evaluatePhoneRevealIdentityEligibility({}), 'missing_person_identity');
  });
});

describe('paridad con el resolutor del servidor', () => {
  // La garantía que importa no es «los dos usan la misma regla» escrito en un comentario,
  // sino que un cambio en `resolvePhoneRevealProviderIdentity` mueva las DOS decisiones a
  // la vez. Se barre la matriz completa de formas de id × origen × cuenta y se exige que la
  // elegibilidad sea exactamente «hay identidad nativa».
  //
  // La cuenta SIGUE en la matriz a propósito, y es la mitad más importante de este test:
  // recorrerla y exigir que NO cambie el resultado es lo que impide que alguien la
  // reintroduzca como requisito sin que nada falle.
  const IDS: readonly (string | null)[] = [
    null,
    '',
    '   ',
    APOLLO_ID,
    APOLLO_ID.toUpperCase(),
    LUSHA_ID,
    'no-es-un-object-id',
    '0123456789abcdef0123456', // 23 hex: uno de menos
    '0123456789abcdef012345678', // 25 hex: uno de más
  ];
  const SOURCES: readonly (string | null)[] = [
    null,
    'apollo',
    'APOLLO',
    'lusha',
    'LUSHA',
    'hubspot',
    'manual',
  ];
  const ACCOUNTS: readonly (string | null)[] = [null, '', '  ', ACCOUNT];

  it('coincide con resolvePhoneRevealProviderIdentity en toda la matriz', () => {
    let checked = 0;
    for (const apolloPersonId of IDS) {
      for (const sourceContactId of IDS) {
        for (const source of SOURCES) {
          for (const accountId of ACCOUNTS) {
            const serverIdentity = resolvePhoneRevealProviderIdentity({
              apolloPersonId,
              source,
              sourceContactId,
            });
            const expected = serverIdentity ? 'eligible' : 'missing_person_identity';

            assert.equal(
              evaluatePhoneRevealIdentityEligibility({
                apolloPersonId,
                source,
                sourceContactId,
                accountId,
              }),
              expected,
              `divergencia en {apolloPersonId:${apolloPersonId}, sourceContactId:${sourceContactId}, source:${source}, accountId:${accountId}}`,
            );
            checked += 1;
          }
        }
      }
    }
    assert.equal(checked, IDS.length * IDS.length * SOURCES.length * ACCOUNTS.length);
  });

  // RATCHET de la Fase 1: la cuenta no puede volver a decidir nada. Para cada combinación
  // de identidad, el veredicto tiene que ser IDÉNTICO con las cuatro cuentas de la matriz.
  it('RATCHET: la cuenta no altera el veredicto en ninguna combinación', () => {
    for (const apolloPersonId of IDS) {
      for (const sourceContactId of IDS) {
        for (const source of SOURCES) {
          const verdicts = ACCOUNTS.map((accountId) =>
            evaluatePhoneRevealIdentityEligibility({
              apolloPersonId,
              source,
              sourceContactId,
              accountId,
            }),
          );
          assert.equal(
            new Set(verdicts).size,
            1,
            `la cuenta cambió el veredicto en {apolloPersonId:${apolloPersonId}, sourceContactId:${sourceContactId}, source:${source}}: ${verdicts.join(' / ')}`,
          );
        }
      }
    }
  });
});

describe('copy del bloqueo', () => {
  it('no nombra a ningún proveedor ni promete un reintento', () => {
    const copy = PHONE_REVEAL_IDENTITY_BLOCKED_COPY.toLowerCase();
    for (const forbidden of [
      'apollo',
      'lusha',
      'unos minutos',
      'inténtalo',
      'intenta de nuevo',
      'vuelve a intentar',
      'reintenta',
      'más tarde',
    ]) {
      assert.equal(
        copy.includes(forbidden),
        false,
        `el copy no debe contener «${forbidden}»: la carencia puede ser permanente`,
      );
    }
  });

  it('explica que la verificación de privacidad es lo que falta', () => {
    assert.match(PHONE_REVEAL_IDENTITY_BLOCKED_COPY, /privacidad/i);
  });
});

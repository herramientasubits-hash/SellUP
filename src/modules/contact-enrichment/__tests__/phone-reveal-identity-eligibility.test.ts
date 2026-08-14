/**
 * Tests — elegibilidad de IDENTIDAD del reveal de teléfono
 * (Agente 2A · AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-2)
 *
 * Qué se verifica:
 *   * la regla del cliente es la MISMA que la del servidor, comprobada por
 *     PARIDAD contra `resolvePhoneCachePersonId` (la función que usan START,
 *     webhook, recovery y la puerta previa a Lusha) — no por una segunda
 *     aproximación escrita a mano;
 *   * cuenta + identidad Apollo válida ⇒ `eligible`;
 *   * sin cuenta ⇒ bloqueado; sin identidad ⇒ bloqueado; sin ninguna ⇒ bloqueado;
 *   * un candidato de origen Lusha con `apollo_person_id` válido + cuenta es
 *     elegible bajo la semántica ACTUAL del backend;
 *   * un `source_contact_id` de Apollo válido cuenta como identidad; uno inválido
 *     (o de otro proveedor, p. ej. Lusha `v1.*`) NO, salvo que la columna propia
 *     `apollo_person_id` sea válida;
 *   * el copy del bloqueo no nombra proveedor ni promete reintento.
 *
 * Puro y offline: sin red, sin Supabase, sin proveedores, sin reloj.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluatePhoneRevealIdentityEligibility,
  PHONE_REVEAL_IDENTITY_BLOCKED_COPY,
} from '../phone-reveal-identity-eligibility';
import { resolvePhoneCachePersonId } from '../phone-cache-core';

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

  it('B. sin cuenta ⇒ missing_account (identidad presente)', () => {
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: APOLLO_ID,
        source: 'apollo',
        sourceContactId: APOLLO_ID,
        accountId: null,
      }),
      'missing_account',
    );
  });

  it('B bis. una cuenta en blanco NO es una cuenta', () => {
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: APOLLO_ID,
        source: 'apollo',
        accountId: '   ',
      }),
      'missing_account',
    );
  });

  it('C. sin identidad de persona ⇒ missing_person_identity (cuenta presente)', () => {
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: null,
        source: 'lusha',
        sourceContactId: LUSHA_ID,
        accountId: ACCOUNT,
      }),
      'missing_person_identity',
    );
  });

  it('D. sin ninguna de las dos ⇒ bloqueado, y se reporta la identidad primero (orden del servidor)', () => {
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: null,
        source: 'lusha',
        sourceContactId: LUSHA_ID,
        accountId: null,
      }),
      'missing_person_identity',
    );
  });

  it('E. candidato Lusha con apollo_person_id válido + cuenta ⇒ eligible (semántica ACTUAL del backend)', () => {
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

  it('G bis. un source_contact_id Apollo válido en un candidato NO Apollo no se reenvía', () => {
    // Espacios de id distintos: solo un candidato de origen Apollo puede reenviar
    // su `source_contact_id` como Apollo person id.
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({
        apolloPersonId: null,
        source: 'lusha',
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
  // La garantía que importa no es "los dos usan la misma regla" escrito en un
  // comentario, sino que un cambio en `resolvePhoneCachePersonId` mueva las DOS
  // decisiones a la vez. Se barre la matriz completa de formas de id × origen y se
  // exige que la elegibilidad sea exactamente "hay person id ∧ hay cuenta".
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
    'hubspot',
    'manual',
  ];
  const ACCOUNTS: readonly (string | null)[] = [null, '', '  ', ACCOUNT];

  it('coincide con resolvePhoneCachePersonId en toda la matriz', () => {
    let checked = 0;
    for (const apolloPersonId of IDS) {
      for (const sourceContactId of IDS) {
        for (const source of SOURCES) {
          for (const accountId of ACCOUNTS) {
            const serverPersonId = resolvePhoneCachePersonId({
              apolloPersonId,
              sourceProvider: source,
              sourceContactId,
            });
            const serverAccount =
              typeof accountId === 'string' && accountId.trim().length > 0;
            const expected = !serverPersonId
              ? 'missing_person_identity'
              : !serverAccount
                ? 'missing_account'
                : 'eligible';

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

/**
 * Tests — Apollo Phone Reveal payload helper (Agente 2A, PHONE-3D.1)
 *
 * Lógica pura: sin red, sin DB, sin proveedores, sin env. Node.js built-in
 * test runner. El helper es el único lugar autorizado para
 * `reveal_phone_number: true`, pero NO ejecuta reveal alguno.
 *
 * También cubre el contrato del flag ENABLE_APOLLO_PHONE_REVEAL (OFF por
 * default, true solo con el valor exacto "true").
 */

import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildApolloPhoneRevealMatchParams,
  type ApolloPhoneRevealResult,
} from '../apollo-phone-reveal';
import { isApolloPhoneRevealEnabled } from '@/lib/feature-flags.server';

// ── Helpers de aserción ────────────────────────────────────────

function expectOk(result: ApolloPhoneRevealResult) {
  assert.equal(result.ok, true, 'esperaba un resultado ok');
  if (!result.ok) throw new Error('unreachable');
  return result.params;
}

// ── Construcción con identidad fuerte ──────────────────────────

describe('buildApolloPhoneRevealMatchParams — identidad fuerte', () => {
  it('con sourceContactId (person id) → reveal_phone_number: true', () => {
    const params = expectOk(
      buildApolloPhoneRevealMatchParams({
        sourceContactId: 'apollo-person-id',
        firstName: 'Ana',
        lastName: 'Gómez',
        organizationName: 'Empresa',
      }),
    );
    assert.equal(params.reveal_phone_number, true);
    assert.equal(params.id, 'apollo-person-id');
    assert.equal(params.first_name, 'Ana');
    assert.equal(params.last_name, 'Gómez');
    assert.equal(params.organization_name, 'Empresa');
  });

  it('con email → reveal_phone_number: true', () => {
    const params = expectOk(
      buildApolloPhoneRevealMatchParams({ email: 'ana@empresa.com' }),
    );
    assert.equal(params.reveal_phone_number, true);
    assert.equal(params.email, 'ana@empresa.com');
  });

  it('con linkedinUrl → reveal_phone_number: true', () => {
    const params = expectOk(
      buildApolloPhoneRevealMatchParams({
        linkedinUrl: 'https://linkedin.com/in/ana',
      }),
    );
    assert.equal(params.reveal_phone_number, true);
    assert.equal(params.linkedin_url, 'https://linkedin.com/in/ana');
  });

  it('prefiere sourceContactId como identificador más fuerte (lo incluye)', () => {
    const params = expectOk(
      buildApolloPhoneRevealMatchParams({
        sourceContactId: 'pid-1',
        email: 'ana@empresa.com',
        linkedinUrl: 'https://linkedin.com/in/ana',
      }),
    );
    assert.equal(params.id, 'pid-1');
    // Los identificadores adicionales también viajan, pero el id está presente.
    assert.equal(params.email, 'ana@empresa.com');
    assert.equal(params.linkedin_url, 'https://linkedin.com/in/ana');
  });

  it('recorta espacios en los campos de identidad', () => {
    const params = expectOk(
      buildApolloPhoneRevealMatchParams({ sourceContactId: '  pid-2  ' }),
    );
    assert.equal(params.id, 'pid-2');
  });
});

// ── reveal_personal_emails NO se agrega ────────────────────────

describe('buildApolloPhoneRevealMatchParams — minimización de datos', () => {
  it('NO agrega reveal_personal_emails (no lo exige el reveal de teléfono)', () => {
    const params = expectOk(
      buildApolloPhoneRevealMatchParams({ sourceContactId: 'pid-1' }),
    );
    assert.equal('reveal_personal_emails' in params, false);
    assert.equal(params.reveal_personal_emails, undefined);
  });

  it('NO incluye ningún número/campo de teléfono en el payload', () => {
    const params = expectOk(
      buildApolloPhoneRevealMatchParams({ sourceContactId: 'pid-1' }),
    );
    // Solo claves de identidad + la bandera de reveal; ningún campo de número.
    const ALLOWED_KEYS = new Set([
      'reveal_phone_number',
      'id',
      'email',
      'linkedin_url',
      'first_name',
      'last_name',
      'organization_name',
      'domain',
    ]);
    for (const key of Object.keys(params)) {
      assert.equal(ALLOWED_KEYS.has(key), true, `clave inesperada en payload: ${key}`);
    }
    // No hay campos de valor de teléfono (Apollo entrega el número, nunca lo enviamos).
    assert.equal('phone' in params, false);
    assert.equal('phone_number' in params, false);
    // El único campo relacionado con teléfono es la bandera de reveal.
    assert.equal(params.reveal_phone_number, true);
  });
});

// ── Rechazo de identidad insuficiente ──────────────────────────

describe('buildApolloPhoneRevealMatchParams — identidad insuficiente', () => {
  it('rechaza input vacío', () => {
    const result = buildApolloPhoneRevealMatchParams({});
    assert.equal(result.ok, false);
    if (result.ok) throw new Error('unreachable');
    assert.equal(result.error, 'insufficient_identity');
  });

  it('rechaza solo nombre + empresa (sin id/email/linkedin)', () => {
    const result = buildApolloPhoneRevealMatchParams({
      firstName: 'Ana',
      lastName: 'Gómez',
      organizationName: 'Empresa',
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error('unreachable');
    assert.equal(result.error, 'insufficient_identity');
  });

  it('rechaza campos de identidad en blanco/whitespace', () => {
    const result = buildApolloPhoneRevealMatchParams({
      sourceContactId: '   ',
      email: '',
      linkedinUrl: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error('unreachable');
    assert.equal(result.error, 'insufficient_identity');
  });

  it('un resultado rechazado NO construye reveal_phone_number', () => {
    const result = buildApolloPhoneRevealMatchParams({});
    assert.equal('params' in result, false);
  });
});

// ── Pureza: sin efectos secundarios ────────────────────────────

describe('buildApolloPhoneRevealMatchParams — pureza', () => {
  it('no muta el input', () => {
    const input = { sourceContactId: 'pid-1', firstName: 'Ana' };
    const snapshot = JSON.stringify(input);
    buildApolloPhoneRevealMatchParams(input);
    assert.equal(JSON.stringify(input), snapshot);
  });

  it('es determinista para el mismo input', () => {
    const input = { sourceContactId: 'pid-1', email: 'ana@empresa.com' };
    const a = buildApolloPhoneRevealMatchParams(input);
    const b = buildApolloPhoneRevealMatchParams(input);
    assert.deepEqual(a, b);
  });
});

// ── Contrato del flag ENABLE_APOLLO_PHONE_REVEAL ───────────────

const FLAG_KEY = 'ENABLE_APOLLO_PHONE_REVEAL';

function withEnv(value: string | undefined, fn: () => void) {
  const saved = process.env[FLAG_KEY];
  if (value === undefined) delete process.env[FLAG_KEY];
  else process.env[FLAG_KEY] = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env[FLAG_KEY];
    else process.env[FLAG_KEY] = saved;
  }
}

describe('isApolloPhoneRevealEnabled — contrato del flag', () => {
  test('undefined → false (default OFF)', () => {
    withEnv(undefined, () => {
      assert.equal(isApolloPhoneRevealEnabled(), false);
    });
  });

  test('"false" → false', () => {
    withEnv('false', () => {
      assert.equal(isApolloPhoneRevealEnabled(), false);
    });
  });

  test('"true" → true (valor exacto)', () => {
    withEnv('true', () => {
      assert.equal(isApolloPhoneRevealEnabled(), true);
    });
  });

  test('"TRUE" / " true " → true (case-insensitive, trim)', () => {
    withEnv('TRUE', () => {
      assert.equal(isApolloPhoneRevealEnabled(), true);
    });
    withEnv(' true ', () => {
      assert.equal(isApolloPhoneRevealEnabled(), true);
    });
  });

  test('"1" / "yes" → false (no son el valor canónico)', () => {
    withEnv('1', () => {
      assert.equal(isApolloPhoneRevealEnabled(), false);
    });
    withEnv('yes', () => {
      assert.equal(isApolloPhoneRevealEnabled(), false);
    });
  });

  test('retorna boolean, no el string crudo', () => {
    withEnv('true', () => {
      assert.equal(typeof isApolloPhoneRevealEnabled(), 'boolean');
    });
  });
});

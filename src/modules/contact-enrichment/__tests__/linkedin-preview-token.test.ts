// AGENT2A-LINKEDIN-CONTACT-SEARCH (F2) — la vista previa viaja firmada entre los dos pasos.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LINKEDIN_PREVIEW_TOKEN_TTL_MS,
  signLinkedinPreviewToken,
  verifyLinkedinPreviewToken,
} from '../linkedin-preview-token';

const SECRET = 'secreto-de-prueba';
const NOW = 1_800_000_000_000;
const DATA = { linkedinUrl: 'https://www.linkedin.com/in/persona-ficticia', email: 'ana@empresa-ficticia.test' };

describe('linkedin-preview-token', () => {
  it('firma y verifica para el mismo usuario', () => {
    const token = signLinkedinPreviewToken(DATA, { userId: 'u1', nowMs: NOW, secret: SECRET });
    assert.deepEqual(verifyLinkedinPreviewToken(token, { userId: 'u1', nowMs: NOW + 1000, secret: SECRET }), { ok: true, data: DATA });
  });

  it('cualquier cambio en el contenido invalida la firma', () => {
    const token = signLinkedinPreviewToken(DATA, { userId: 'u1', nowMs: NOW, secret: SECRET });
    const [body, sig] = token.split('.');
    const tampered = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    tampered.data.email = 'otro@empresa-ficticia.test';
    const forged = `${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${sig}`;
    assert.deepEqual(verifyLinkedinPreviewToken(forged, { userId: 'u1', nowMs: NOW, secret: SECRET }), { ok: false, error: 'bad_signature' });
  });

  it('otro usuario, caducado, otra clave o basura: no sirve', () => {
    const token = signLinkedinPreviewToken(DATA, { userId: 'u1', nowMs: NOW, secret: SECRET });
    assert.deepEqual(verifyLinkedinPreviewToken(token, { userId: 'u2', nowMs: NOW, secret: SECRET }), { ok: false, error: 'wrong_user' });
    assert.deepEqual(
      verifyLinkedinPreviewToken(token, { userId: 'u1', nowMs: NOW + LINKEDIN_PREVIEW_TOKEN_TTL_MS + 1, secret: SECRET }),
      { ok: false, error: 'expired' },
    );
    assert.deepEqual(verifyLinkedinPreviewToken(token, { userId: 'u1', nowMs: NOW, secret: 'otra' }), { ok: false, error: 'bad_signature' });
    assert.deepEqual(verifyLinkedinPreviewToken('x', { userId: 'u1', nowMs: NOW, secret: SECRET }), { ok: false, error: 'malformed' });
    assert.deepEqual(verifyLinkedinPreviewToken(null, { userId: 'u1', nowMs: NOW, secret: SECRET }), { ok: false, error: 'malformed' });
    assert.deepEqual(verifyLinkedinPreviewToken(token, { userId: 'u1', nowMs: NOW, secret: null }), { ok: false, error: 'no_secret' });
  });

  it('sin secreto no se firma', () => {
    assert.throws(() => signLinkedinPreviewToken(DATA, { userId: 'u1', nowMs: NOW, secret: '' }));
  });
});

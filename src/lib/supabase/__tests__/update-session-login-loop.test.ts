// ERR_TOO_MANY_REDIRECTS (29-10): con una sesión revocada pero un JWT todavía vigente,
// el proxy mandaba /login → /pipeline y el layout (getUser) devolvía a /login sin fin.
// En /login, «autenticado» exige que Supabase confirme la sesión.
// Run: node --import tsx --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { updateSession } from '../middleware';

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:9';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'test';

function fakeClient(opts: { claims: boolean; userOk: boolean }) {
  let getUserCalls = 0;
  const factory = (() => ({
    auth: {
      getClaims: async () => ({ data: opts.claims ? { claims: { sub: 'u1' } } : null, error: null }),
      getUser: async () => {
        getUserCalls++;
        return opts.userOk
          ? { data: { user: { id: 'u1' } }, error: null }
          : { data: { user: null }, error: new Error('session revoked') };
      },
    },
  })) as unknown as Parameters<typeof updateSession>[1];
  return { factory, calls: () => getUserCalls };
}

const req = (path: string) => new NextRequest(new URL(`https://sellup.test${path}`));

describe('updateSession — /login no rebota con una sesión revocada', () => {
  it('JWT vigente pero sesión revocada: en /login NO cuenta como autenticado', async () => {
    const c = fakeClient({ claims: true, userOk: false });
    const r = await updateSession(req('/login'), c.factory);
    assert.equal(r.isAuthenticated, false);
    assert.equal(c.calls(), 1);
  });

  it('sesión viva: en /login sí cuenta como autenticado (va a /pipeline)', async () => {
    const c = fakeClient({ claims: true, userOk: true });
    assert.equal((await updateSession(req('/login'), c.factory)).isAuthenticated, true);
  });

  it('fuera de /login no se llama a Supabase: basta el JWT (igual que antes)', async () => {
    const c = fakeClient({ claims: true, userOk: false });
    assert.equal((await updateSession(req('/pipeline'), c.factory)).isAuthenticated, true);
    assert.equal(c.calls(), 0);
  });

  it('sin JWT: no autenticado y sin llamada extra', async () => {
    const c = fakeClient({ claims: false, userOk: false });
    assert.equal((await updateSession(req('/login'), c.factory)).isAuthenticated, false);
    assert.equal(c.calls(), 0);
  });
});

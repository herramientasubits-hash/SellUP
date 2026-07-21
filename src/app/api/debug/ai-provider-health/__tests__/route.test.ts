// Tests for src/app/api/debug/ai-provider-health/route.ts —
// 17B.4X.7C.5D.3A (Batch 1 Supabase fallback migration).
//
// The production block (`NODE_ENV === 'production'` → 403) runs before any
// Supabase or auth code, so it is exercised behaviorally with a real
// NextRequest/GET call. Beyond that point the handler calls createClient()
// from '@/lib/supabase/server' (next/headers cookies()) to resolve the
// current user, which requires a live Next.js request context unavailable
// under `node --test` — so the "uses createSupabaseAdminClient() in
// non-production" contract is covered by static source-inspection only,
// consistent with the documented limitation for cookies()-gated code.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET } from '../route';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(moduleDir, '..', 'route.ts'), 'utf8');

describe('ai-provider-health route — admin client wiring (post 17B.4X.7C.5D.3A)', () => {
  it('imports createSupabaseAdminClient from @/lib/supabase/admin', () => {
    assert.match(
      source,
      /import\s*\{\s*createSupabaseAdminClient\s*\}\s*from\s*['"]@\/lib\/supabase\/admin['"]/,
    );
  });

  it('getAdmin() delegates to createSupabaseAdminClient() with no fallback', () => {
    const start = source.indexOf('function getAdmin()');
    assert.ok(start !== -1, 'expected to find function getAdmin()');
    const body = source.slice(start, start + 200);
    assert.match(body, /createSupabaseAdminClient\(\)/);
  });

  it('does not contain a hardcoded Supabase project URL', () => {
    assert.equal(source.includes('lrdruowtadwbdulndlph.supabase.co'), false);
  });

  it('does not read SUPABASE_SERVICE_ROLE_KEY directly (guard owns that read)', () => {
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('still blocks in production before touching Supabase', () => {
    const start = source.indexOf('export async function GET');
    assert.ok(start !== -1);
    const body = source.slice(start, start + 300);
    assert.match(body, /NODE_ENV === 'production'/);
    assert.match(body, /status: 403/);
  });
});

describe('ai-provider-health route — admin gate (parity with agent1-apollo-config)', () => {
  it('calls the is_admin RPC with the authenticated user id', () => {
    assert.match(
      source,
      /supabase\.rpc\(\s*['"]is_admin['"]\s*,\s*\{\s*p_auth_user_id:\s*user\.id/,
    );
  });

  it('returns 403 for authenticated non-admin users', () => {
    assert.match(source, /if\s*\(!isAdmin\)/);
    assert.match(source, /Acceso restringido a administradores/);
  });

  it('gates admin before instantiating the service-role client', () => {
    const adminCheckIdx = source.indexOf('if (!isAdmin)');
    const getAdminCallIdx = source.indexOf('const admin = getAdmin()');
    assert.ok(adminCheckIdx !== -1, 'expected admin gate');
    assert.ok(getAdminCallIdx !== -1, 'expected getAdmin() call');
    assert.ok(
      adminCheckIdx < getAdminCallIdx,
      'admin gate must run before the diagnostic reads (getAdmin)',
    );
  });

  it('checks authentication (401) before the admin gate (403)', () => {
    const authIdx = source.indexOf("status: 401");
    const adminCheckIdx = source.indexOf('if (!isAdmin)');
    assert.ok(authIdx !== -1 && adminCheckIdx !== -1);
    assert.ok(authIdx < adminCheckIdx, '401 auth check must precede admin gate');
  });
});

function withNodeEnv(value: string | undefined, fn: () => Promise<void>) {
  const env = process.env as Record<string, string | undefined>;
  const saved = env.NODE_ENV;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
  return fn().finally(() => {
    if (saved === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = saved;
  });
}

describe('ai-provider-health route — production guard (behavioral)', () => {
  it('returns 403 and never reaches the Supabase admin client when NODE_ENV=production', async () => {
    await withNodeEnv('production', async () => {
      const request = new NextRequest('http://localhost/api/debug/ai-provider-health');
      const response = await GET(request);
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.error, 'Not available in production');
    });
  });
});

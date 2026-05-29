'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { runSourceConnectionTest } from '@/server/source-catalog/connection-test/run-source-connection-test';
import type { SourceConnectionTestResult } from '@/server/source-catalog/connection-test/types';
import { nowIso } from '@/server/source-catalog/connection-test/helpers';
import { CATALOG_SOURCES } from '@/server/agents/prospecting-toolkit/source-catalog';
import { persistSourceConnectionTest } from '@/server/source-catalog/connection-test/persist-source-connection-test';

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function requireActiveUser(): Promise<{
  internalUserId: string;
  userEmail: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/login');
  return { internalUserId: internalUser.id, userEmail: user.email ?? null };
}

// ─── Rate limit (in-memory, single instance) ──────────────────────────────────

type RateLimitEntry = { count: number; windowStart: number };
const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 3;

function checkRateLimit(userId: string, sourceKey: string): boolean {
  const key = `${userId}:${sourceKey}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;

  entry.count += 1;
  return true;
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function testSourceConnectionAction(
  sourceKey: string,
): Promise<SourceConnectionTestResult> {
  const { internalUserId, userEmail } = await requireActiveUser();

  if (!checkRateLimit(internalUserId, sourceKey)) {
    return {
      sourceKey,
      strategy: 'not_supported',
      status: 'failed',
      httpStatus: null,
      responseTimeMs: null,
      checkedAt: nowIso(),
      testedUrl: null,
      contentType: null,
      contentLength: null,
      errorCode: 'UNKNOWN_ERROR',
      errorMessage: null,
      recommendation:
        'Espera unos segundos antes de volver a probar esta fuente.',
      metadata: { rateLimited: true },
    };
  }

  const result = await runSourceConnectionTest(sourceKey);

  const source = CATALOG_SOURCES.find((s) => s.key === sourceKey) ?? null;

  // Persist asynchronously; failure must not affect the returned result
  void persistSourceConnectionTest({
    result,
    source,
    internalUserId,
    userEmail,
  });

  return result;
}

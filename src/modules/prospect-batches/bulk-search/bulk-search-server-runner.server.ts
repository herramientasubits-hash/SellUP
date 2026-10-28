import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createMemoryCookieJar, runWithSessionCookies } from '@/lib/supabase/session-override';
import type { BulkRoundResponse } from './bulk-search-engine';
import { canRunOnBehalfOf } from './bulk-search-server-chain';
import { resolveBulkSearchAccess, runBulkSearchRoundForUser } from './bulk-search-service.server';

/**
 * La búsqueda masiva corre sola en el servidor (dueña 28-10).
 *
 * Una ronda es una corrida normal de Rumbo, y esa corrida trabaja con la sesión de
 * quien la lanzó (permisos, alcance, quién paga). Sin navegador no hay cookies, así
 * que el servidor abre una sesión de un solo uso a nombre de esa persona —con la
 * clave de servicio, sin mandar ningún correo—, corre la ronda dentro de esa sesión
 * (`runWithSessionCookies`) y la cierra al terminar. Antes comprueba que la búsqueda
 * siga en curso y que la persona siga activa y con permiso (Growth o admin).
 *
 * Apagada por defecto (`ENABLE_GROWTH_BULK_SEARCH_SERVER_RUNNER`, ver
 * `bulk-search-flag.server.ts`): sin ella, sólo avanza con SellUp abierto.
 */
export type ServerRoundOutcome =
  | { ok: true; response: BulkRoundResponse }
  | { ok: false; reason: 'not_running' | 'not_allowed' | 'session_unavailable' | 'identity_mismatch' | 'round_failed' };

interface SearchOwner {
  internalUserId: string;
  authUserId: string;
}

/** La búsqueda en curso y quién la lanzó, si todavía puede conducirse a su nombre. */
async function loadRunnableOwner(bulkSearchId: string): Promise<SearchOwner | ServerRoundOutcome> {
  const admin = createSupabaseAdminClient();
  const { data: search } = await admin
    .from('prospect_bulk_searches')
    .select('id, created_by, status')
    .eq('id', bulkSearchId)
    .maybeSingle();
  const row = search as { created_by: string; status: string } | null;
  if (!row || row.status !== 'running') return { ok: false, reason: 'not_running' };

  const { data: user } = await admin
    .from('internal_users')
    .select('id, auth_user_id')
    .eq('id', row.created_by)
    .maybeSingle();
  const authUserId = (user as { auth_user_id: string | null } | null)?.auth_user_id ?? null;
  if (!authUserId) return { ok: false, reason: 'not_allowed' };

  const [{ data: internal }, { data: isAdmin }] = await Promise.all([
    admin.rpc('get_internal_user', { p_auth_user_id: authUserId }),
    admin.rpc('is_admin', { p_auth_user_id: authUserId }),
  ]);
  const facts = (Array.isArray(internal) ? internal[0] : null) as { access_status?: string; role_key?: string } | null;
  const allowed = canRunOnBehalfOf({
    accessStatus: facts?.access_status ?? null,
    roleKey: facts?.role_key ?? null,
    isAdmin: isAdmin === true,
  });
  if (!allowed) return { ok: false, reason: 'not_allowed' };
  return { internalUserId: row.created_by, authUserId };
}

/**
 * Una sesión de un solo uso a nombre de la persona: enlace mágico generado por el
 * servidor (no se envía) y canjeado al momento. `null` si Supabase no la da.
 */
async function openSessionFor(authUserId: string) {
  const admin = createSupabaseAdminClient();
  const { data: authUser } = await admin.auth.admin.getUserById(authUserId);
  const email = authUser?.user?.email;
  if (!email) return null;
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) return null;

  const jar = createMemoryCookieJar();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: { getAll: () => jar.getAll(), setAll: (next) => jar.setAll(next) },
  });
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (verifyError || verified.user?.id !== authUserId) return null;
  return { jar, client };
}

/**
 * Cierra SÓLO esta sesión (no las que la persona tenga abiertas en su navegador).
 * Si el cierre normal falla, se intenta con la clave de servicio y se deja rastro:
 * una sesión prestada no puede quedarse viva en silencio.
 */
async function closeSession(client: ReturnType<typeof createServerClient>): Promise<void> {
  const { data } = await client.auth.getSession().catch(() => ({ data: { session: null } }));
  const accessToken = data.session?.access_token ?? null;
  const { error } = await client.auth.signOut({ scope: 'local' }).catch((cause: unknown) => ({ error: cause }));
  if (!error) return;
  console.error('[BulkSearchServerRunner] no se pudo cerrar la sesión prestada; se cierra con la clave de servicio');
  if (!accessToken) return;
  const { error: adminError } = await createSupabaseAdminClient()
    .auth.admin.signOut(accessToken, 'local')
    .catch((cause: unknown) => ({ error: cause }));
  if (adminError) console.error('[BulkSearchServerRunner] la sesión prestada sigue abierta hasta que caduque');
}

/** Corre UNA ronda de la búsqueda a nombre de quien la lanzó. Nunca lanza. */
export async function runBulkSearchRoundOnServer(bulkSearchId: string): Promise<ServerRoundOutcome> {
  try {
    const owner = await loadRunnableOwner(bulkSearchId);
    if ('ok' in owner) return owner;

    const session = await openSessionFor(owner.authUserId);
    if (!session) return { ok: false, reason: 'session_unavailable' };
    try {
      return await runWithSessionCookies(session.jar, async () => {
        // La misma puerta que la ruta del navegador, ya con la sesión de la persona.
        const access = await resolveBulkSearchAccess();
        if (!access.ok) return { ok: false, reason: 'not_allowed' } as const;
        if (access.userId !== owner.internalUserId) return { ok: false, reason: 'identity_mismatch' } as const;
        return { ok: true, response: await runBulkSearchRoundForUser(access.userId, bulkSearchId) } as const;
      });
    } finally {
      await closeSession(session.client);
    }
  } catch (error) {
    console.error('[BulkSearchServerRunner] ronda fallida', bulkSearchId, error instanceof Error ? error.message : error);
    return { ok: false, reason: 'round_failed' };
  }
}

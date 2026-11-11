import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createMemoryCookieJar, runWithSessionCookies, type SessionCookieJar } from '@/lib/supabase/session-override';

/**
 * Sesión prestada a nombre de una persona (asistente de Slack, dueña 11-11).
 *
 * Mismo mecanismo que la búsqueda masiva en el servidor
 * (`bulk-search-server-runner.server.ts`, que se deja como está): sin navegador
 * no hay cookies, así que el servidor abre una sesión de UN SOLO USO a nombre de
 * la persona —enlace mágico generado con la clave de servicio, sin enviar ningún
 * correo— y corre el trabajo dentro de `runWithSessionCookies`. Mientras dura,
 * `createClient()` es la sesión de esa persona: las acciones de la plataforma
 * aplican SUS permisos, SU alcance y la registran como suya. Al terminar se
 * cierra sólo esa sesión.
 *
 * Sólo lo usa código de servidor que YA comprobó quién es la persona.
 */
interface BorrowedSession {
  jar: SessionCookieJar;
  client: ReturnType<typeof createServerClient>;
}

async function openSessionFor(authUserId: string): Promise<BorrowedSession | null> {
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

/** Cierra SÓLO esta sesión; si falla, con la clave de servicio, y deja rastro. */
async function closeSession(client: ReturnType<typeof createServerClient>): Promise<void> {
  const { data } = await client.auth.getSession().catch(() => ({ data: { session: null } }));
  const accessToken = data.session?.access_token ?? null;
  const { error } = await client.auth.signOut({ scope: 'local' }).catch((cause: unknown) => ({ error: cause }));
  if (!error) return;
  console.error('[BorrowedSession] no se pudo cerrar la sesión prestada; se cierra con la clave de servicio');
  if (!accessToken) return;
  const { error: adminError } = await createSupabaseAdminClient()
    .auth.admin.signOut(accessToken, 'local')
    .catch((cause: unknown) => ({ error: cause }));
  if (adminError) console.error('[BorrowedSession] la sesión prestada sigue abierta hasta que caduque');
}

/**
 * Corre `fn` con la sesión de la persona. `{ ok: false }` si Supabase no da la
 * sesión (nunca corre `fn` sin ella). La sesión se cierra siempre.
 */
export async function runAsUser<T>(
  authUserId: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; reason: 'session_unavailable' }> {
  const session = await openSessionFor(authUserId);
  if (!session) return { ok: false, reason: 'session_unavailable' };
  try {
    return { ok: true, value: await runWithSessionCookies(session.jar, fn) };
  } finally {
    await closeSession(session.client);
  }
}

'use server';

// Agente 2A — Apollo → Lusha phone reveal waterfall: Server Action de LECTURA
// (AGENT2A-PHONE-WATERFALL-1)
//
// `phone_reveal_waterfall_runs` es service_role-only (migración 102: RLS activa y
// SIN política para `authenticated`), así que el drawer no puede leerla con el
// cliente de sesión como hace con el candidato. Esta acción es la ÚNICA puerta:
// autentica, exige la MISMA autoridad de rol que el reveal
// (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1: no hay un permiso de «ver la
// auditoría» distinto del de revelar), lee con service role y devuelve una
// proyección PII-free.
//
// Es de solo lectura. NO crea corridas, NO reclama la pata Lusha, NO llama a
// ningún proveedor, NO escribe en la corrida ni en el candidato y NO gasta
// créditos. La creación vive en el START del reveal (phone-reveal-actions.ts) y la
// continuación en el webhook / recovery, nunca en una acción disparada por la UI.
//
// Devuelve `null` — no un error — cuando el flag está apagado, el rol no está
// autorizado o el candidato no tiene ninguna corrida: la UI simplemente no muestra
// el bloque de auditoría.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isPhoneRevealWaterfallEnabled } from '@/lib/feature-flags.server';
import {
  buildPhoneRevealWaterfallAuditView,
  buildPhoneRevealWaterfallAuthorizationPreview,
  isPhoneRevealWaterfallRoleAuthorized,
  type PhoneRevealWaterfallAuditView,
  type PhoneRevealWaterfallAuthorizationPreview,
} from './phone-reveal-waterfall-core';
import {
  findLatestWaterfallRunForCandidate,
  loadCandidateForWaterfall,
} from './phone-reveal-waterfall-deps';

/**
 * Resuelve el usuario interno activo y su role key. Espejo de
 * `resolveActorForLushaFallback` / `resolveActorForReveal`: sin usuario redirige a
 * /login, y un actor sin rol conocido queda no autorizado.
 */
async function resolveActorRoleKey(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/login');
  if (!internalUser.role_id) return null;

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', internalUser.role_id)
    .single();
  return typeof role?.key === 'string' ? role.key : null;
}

/**
 * Auditoría por proveedor de la corrida MÁS RECIENTE del candidato: qué intentó
 * Apollo, qué intentó (u omitió, y por qué) Lusha, cuánto costó cada pata por
 * separado, cuál fue el proveedor final y hasta cuánto autorizó el operador.
 *
 * La proyección es PII-free por construcción (ver `PhoneRevealWaterfallAuditView`):
 * solo códigos mecánicos, booleanos y conteos de créditos. Nunca el teléfono, la
 * identidad, el id de la corrida ni ningún id de proveedor.
 */
export async function getPhoneRevealWaterfallAuditAction(input: {
  candidateId: string;
}): Promise<PhoneRevealWaterfallAuditView | null> {
  if (!isPhoneRevealWaterfallEnabled()) return null;

  const candidateId =
    typeof input?.candidateId === 'string' ? input.candidateId.trim() : '';
  if (!candidateId) return null;

  const roleKey = await resolveActorRoleKey();
  if (!isPhoneRevealWaterfallRoleAuthorized(roleKey)) return null;

  try {
    const run = await findLatestWaterfallRunForCandidate(candidateId);
    return run ? buildPhoneRevealWaterfallAuditView(run) : null;
  } catch (err) {
    // La auditoría es informativa: si la tabla no está disponible (p.ej. la
    // migración 102 aún no aplicada en ese entorno) el drawer no muestra el bloque
    // en vez de reventar la revisión del candidato.
    console.error(
      '[phone-reveal-waterfall] audit read failed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return null;
  }
}

/**
 * Vista previa de la AUTORIZACIÓN del botón, ANTES del clic
 * (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1).
 *
 * POR QUÉ EXISTE: el copy dinámico (8 / 13 / 14) ya estaba escrito, pero el drawer lo
 * elegía con una regla PROPIA —«el candidato nació en Lusha y trae su id»— que no
 * conoce ni las identidades ya persistidas (`contact_provider_identities`, migración
 * 124) ni si hay datos con los que buscar. Resultado: un candidato Apollo con email y
 * LinkedIn leía «hasta 8 créditos» mientras el arranque reservaba 14. Esta acción
 * devuelve la modalidad calculada por el MISMO core puro que la reserva, así que el
 * número mostrado y el reservado no pueden discrepar.
 *
 * Es de SOLO LECTURA y no autoriza nada: no crea corridas, no reclama patas, no llama
 * a ningún proveedor, no reserva créditos y no escribe. La proyección es PII-free (dos
 * booleanos y un entero).
 *
 * Devuelve `null` —y la UI cae a su clasificación conservadora, que nunca promete 14—
 * cuando el flag está apagado, el rol no puede revelar teléfono o los hechos de
 * identidad no se pueden leer (por ejemplo con la migración 124 sin aplicar).
 */
export async function getPhoneRevealWaterfallAuthorizationPreviewAction(input: {
  candidateId: string;
}): Promise<PhoneRevealWaterfallAuthorizationPreview | null> {
  if (!isPhoneRevealWaterfallEnabled()) return null;

  const candidateId =
    typeof input?.candidateId === 'string' ? input.candidateId.trim() : '';
  if (!candidateId) return null;

  // MISMA autoridad que el arranque: no hay un permiso de "ver el copy" distinto del
  // permiso de revelar.
  const roleKey = await resolveActorRoleKey();
  if (!isPhoneRevealWaterfallRoleAuthorized(roleKey)) return null;

  try {
    // MISMA lectura que `buildStartWaterfallDeps`: identidades persistidas + hechos de
    // búsqueda. Sin esto la respuesta sería la de antes del hito y volvería a decir 8
    // donde el servidor reserva 14.
    const candidate = await loadCandidateForWaterfall(candidateId, {
      includeIdentityFacts: true,
    });
    if (!candidate) return null;
    return buildPhoneRevealWaterfallAuthorizationPreview(candidate);
  } catch (err) {
    // Fail-closed hacia el copy conservador: si las identidades no se pueden leer, NO
    // se afirma que haya una búsqueda pagada disponible.
    console.error(
      '[phone-reveal-waterfall] authorization preview read failed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return null;
  }
}

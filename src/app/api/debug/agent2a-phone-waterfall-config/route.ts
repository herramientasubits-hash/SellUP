/**
 * GET /api/debug/agent2a-phone-waterfall-config
 *
 * Diagnóstico runtime seguro del phone reveal waterfall del Agente 2A
 * (AGENT2A-PHONE-REVEAL-UI-STATE-1 § 11).
 *
 * Existe porque los flags de Vercel son `type: sensitive`: su valor es ilegible
 * para siempre (ni la API con `?decrypt=true` lo devuelve, ni hay `env get`), así
 * que `vercel env ls` sólo prueba PRESENCIA. Sin este endpoint, «el flag está
 * listado» y «el waterfall está activo» eran indistinguibles, y confirmarlo exigía
 * inferirlo del comportamiento de la UI.
 *
 * Responde a DOS preguntas separadas, que es justo lo que faltaba:
 *   * `phone_reveal_waterfall_flag_configured` — ¿la variable EXISTE en este
 *     runtime? (presencia, nunca el valor);
 *   * `phone_reveal_waterfall_enabled_resolved` — ¿el runtime la resuelve como
 *     activa? Se obtiene llamando a `isPhoneRevealWaterfallEnabled()`, la MISMA
 *     función que gobierna producción: aquí no se duplica el parseo, porque una
 *     segunda implementación podría discrepar del runtime real y entonces el
 *     diagnóstico mentiría con toda confianza.
 *
 * Las dos juntas distinguen los tres casos posibles: ausente
 * (`false`/`false`), presente con un valor que no es exactamente `"true"`
 * (`true`/`false`) y presente y activa (`true`/`true`).
 *
 * DESDE AGENT2A-SEARCH-MORE-PHONES-1E publica el MISMO par para el OTRO flag de
 * teléfono, `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK`:
 *   * `lusha_phone_reveal_fallback_flag_configured`
 *   * `lusha_phone_reveal_fallback_enabled_resolved`
 *
 * Se añadió porque ese flag es el permiso de producto que gobierna «Buscar más
 * números», y con él OFF el planificador devuelve `feature_disabled`, cuyo copy es
 * `null` a propósito: la UI se resuelve NO RENDERIZANDO. El síntoma —«no hay CTA y
 * no hay explicación»— es entonces IDÉNTICO al de un preflight que falló, y sin leer
 * el flag en el runtime que se está mirando los dos casos no se pueden separar.
 * Sigue sin devolverse ningún valor crudo: sólo dos booleanos y el nombre.
 *
 * Acceso: admin-only (sesión autenticada + RPC `is_admin`), igual que
 * /api/debug/agent1-apollo-config.
 *
 * Garantías: es de SOLO LECTURA y no toca proveedores. No llama a Apollo, no
 * llama a Lusha, no construye clientes de proveedor, no consume créditos, no
 * escribe en `provider_usage_logs`, no lee ni devuelve datos de candidatos (por
 * tanto no expone PII) y no devuelve API keys, valores crudos de env, la
 * service-role key ni ningún otro secreto. Tampoco activa nada: leer este
 * endpoint no cambia el estado del waterfall.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  isLushaPhoneRevealFallbackEnabled,
  isLushaPhoneRevealFallbackFlagConfigured,
  isPhoneRevealWaterfallEnabled,
  isPhoneRevealWaterfallFlagConfigured,
  LUSHA_PHONE_REVEAL_FALLBACK_FLAG,
  PHONE_REVEAL_WATERFALL_FLAG,
} from '@/lib/feature-flags.server';

/**
 * Diagnóstico siempre fresco: un flag puede cambiar entre dos despliegues y una
 * respuesta cacheada convertiría este endpoint en la fuente de una conclusión
 * obsoleta — exactamente el problema que viene a resolver.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'No autorizado' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { data: isAdmin } = await supabase.rpc('is_admin', {
    p_auth_user_id: user.id,
  });

  if (!isAdmin) {
    return NextResponse.json(
      { error: 'Acceso restringido a administradores' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      config_version: 'agent2a_phone_waterfall_runtime_diagnostics_v2',
      diagnosis_timestamp: new Date().toISOString(),
      // NOMBRE de la variable, nunca su valor. Publicarlo evita que el operador
      // tenga que adivinar cuál de los flags de teléfono se está comprobando
      // (`ENABLE_LUSHA_PHONE_REVEAL_FALLBACK` es otro distinto).
      phone_reveal_waterfall_flag_name: PHONE_REVEAL_WATERFALL_FLAG,
      phone_reveal_waterfall_flag_configured: isPhoneRevealWaterfallFlagConfigured(),
      phone_reveal_waterfall_enabled_resolved: isPhoneRevealWaterfallEnabled(),
      // El OTRO flag de teléfono, publicado con el MISMO par presencia/resolución
      // (AGENT2A-SEARCH-MORE-PHONES-1E). Es el kill switch real de cualquier reveal de
      // Lusha, y por tanto el permiso de producto que gobierna «Buscar más números»: con
      // este OFF el planificador devuelve `feature_disabled` y la UI se resuelve NO
      // RENDERIZANDO —sin CTA y sin copy—, que a ojo es idéntico a un fallo del preflight.
      // Publicarlo aquí es lo que separa «el permiso está apagado» de «algo se rompió».
      //
      // Se resuelve con la MISMA función que gobierna producción
      // (`isLushaPhoneRevealFallbackEnabled`), nunca con un segundo parseo: una segunda
      // implementación podría discrepar del runtime real y entonces el diagnóstico mentiría
      // con toda confianza. Igual que arriba, se publica el NOMBRE y nunca el valor.
      lusha_phone_reveal_fallback_flag_name: LUSHA_PHONE_REVEAL_FALLBACK_FLAG,
      lusha_phone_reveal_fallback_flag_configured:
        isLushaPhoneRevealFallbackFlagConfigured(),
      lusha_phone_reveal_fallback_enabled_resolved: isLushaPhoneRevealFallbackEnabled(),
      runtime_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

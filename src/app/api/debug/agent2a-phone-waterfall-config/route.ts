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
 * DESDE AGENT2A-SEARCH-MORE-PHONES-1E publicó el MISMO par para el OTRO flag de
 * teléfono, `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK`:
 *   * `lusha_phone_reveal_fallback_flag_configured`
 *   * `lusha_phone_reveal_fallback_enabled_resolved`
 *
 * Se añadió porque en ese momento ese flag era el permiso de producto que gobernaba
 * «Buscar más números», y con él OFF el planificador devuelve `feature_disabled`, cuyo
 * copy es `null` a propósito: la UI se resuelve NO RENDERIZANDO. El síntoma —«no hay
 * CTA y no hay explicación»— es entonces IDÉNTICO al de un preflight que falló, y sin
 * leer el flag en el runtime que se está mirando los dos casos no se pueden separar.
 * Se conservan estos dos campos aunque 1H deje de leer este flag para «Buscar más
 * números»: siguen siendo el diagnóstico REAL del fallback manual de Lusha, que sigue
 * vivo, y retirarlos rompería ese diagnóstico sin motivo.
 *
 * DESDE AGENT2A-SEARCH-MORE-PHONES-1H publica el MISMO par para el flag DEDICADO que
 * reemplaza al anterior como permiso de «Buscar más números»,
 * `ENABLE_SEARCH_MORE_PHONES`:
 *   * `search_more_phones_flag_configured`
 *   * `search_more_phones_enabled_resolved`
 *
 * Los DOS pares —el de arriba y este— se publican JUNTOS a propósito, sin fusionarse
 * en uno: es lo que permite comprobar en runtime que los dos flags son
 * INDEPENDIENTES (ninguno activa al otro) y que «Buscar más números» ya no depende del
 * primero. Sigue sin devolverse ningún valor crudo: sólo booleanos y los nombres.
 *
 * DESDE AGENT2A-LOCAL-REUSE-PROD-OBSERVABILITY-1 publica el MISMO par
 * presencia/resolución para los DOS flags del enrutado automático de contactos, que
 * hasta ahora no aparecían en NINGÚN endpoint:
 *   * `contactEnrichmentAutomaticRouting` — `ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING`
 *   * `contactEnrichmentLocalReuseGate` — `ENABLE_CONTACT_ENRICHMENT_LOCAL_REUSE_GATE`
 *
 * Se añaden porque su valor en Producción era literalmente ILEGIBLE: los registros de
 * Vercel son `type: sensitive` y el token local está caducado, así que ni el valor ni
 * —a falta de este endpoint— su resolución en runtime se podían comprobar. El caso que
 * eso deja indefendible es el de #318: con `…LOCAL_REUSE_GATE` OFF la protección
 * PRE-Lusha-Prospecting NO EXISTE, y lo observable —una corrida que sí llama a Lusha—
 * es idéntico a una corrida donde la puerta se evaluó y no acertó. «La protección está
 * activa» sólo se podía suponer.
 *
 * Se publican JUNTOS y sin fusionarse porque el primero es el MASTER SWITCH: con
 * `automaticRouting.resolved === false` el segundo es INALCANZABLE, resuelva lo que
 * resuelva. Leídos en pareja, `resolved:false` en el master explica por sí solo que la
 * puerta de reuso local no corra, sin acusar al flag equivocado.
 *
 * Estos dos bloques usan claves ANIDADAS (`{flagName, configured, resolved}`) en lugar
 * del `<flag>_flag_configured` plano de los tres pares anteriores. Es la forma pedida
 * explícitamente por el hito; los campos planos preexistentes NO se tocan.
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
  CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG,
  getContactEnrichmentRoutingConfigV1,
  isContactEnrichmentAutomaticRoutingFlagConfigured,
} from '@/modules/contact-enrichment-routing/routing-config.server';
import {
  CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG,
  isContactEnrichmentLocalReuseGateEnabled,
  isContactEnrichmentLocalReuseGateFlagConfigured,
  isLushaPhoneRevealFallbackEnabled,
  isLushaPhoneRevealFallbackFlagConfigured,
  isPhoneRevealWaterfallEnabled,
  isPhoneRevealWaterfallFlagConfigured,
  isSearchMorePhonesEnabled,
  isSearchMorePhonesFlagConfigured,
  LUSHA_PHONE_REVEAL_FALLBACK_FLAG,
  PHONE_REVEAL_WATERFALL_FLAG,
  SEARCH_MORE_PHONES_FLAG,
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
      config_version: 'agent2a_phone_waterfall_runtime_diagnostics_v3',
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
      // El flag DEDICADO de «Buscar más números» desde AGENT2A-SEARCH-MORE-PHONES-1H. Ya NO
      // es `lusha_phone_reveal_fallback_enabled_resolved` el que gobierna esta operación —esa
      // reutilización se retiró justamente porque acoplaba dos rollouts que el producto quiere
      // independientes—, así que este es el campo que hay que mirar para saber si el CTA del
      // candidato puede aparecer. Resuelto con la MISMA función que gobierna producción, nunca
      // con un segundo parseo, e igual que el resto de este endpoint: sólo el NOMBRE, nunca el
      // valor.
      search_more_phones_flag_name: SEARCH_MORE_PHONES_FLAG,
      search_more_phones_flag_configured: isSearchMorePhonesFlagConfigured(),
      search_more_phones_enabled_resolved: isSearchMorePhonesEnabled(),
      // ── Enrutado automático de contactos (AGENT2A-LOCAL-REUSE-PROD-OBSERVABILITY-1) ──
      //
      // El MASTER SWITCH. Léelo PRIMERO: con `resolved: false` el enrutador automático
      // no hace nada en absoluto, así que la puerta de reuso local de abajo es
      // inalcanzable resuelva lo que resuelva, y atribuirle a ELLA lo que no ocurre es
      // el error que este par existe para evitar.
      //
      // `resolved` se obtiene de `getContactEnrichmentRoutingConfigV1()`, el MISMO
      // accesor que gobierna producción, nunca de un segundo parseo del env: una
      // segunda implementación podría discrepar del runtime real y entonces el
      // diagnóstico mentiría con toda confianza. Sólo el NOMBRE y dos booleanos —el
      // valor crudo no sale de aquí.
      contactEnrichmentAutomaticRouting: {
        flagName: CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG,
        configured: isContactEnrichmentAutomaticRoutingFlagConfigured(),
        resolved: getContactEnrichmentRoutingConfigV1().automaticRoutingEnabled,
      },
      // La puerta de reuso local pre-proveedor de #318: con ella activa, una corrida
      // que ya tiene un candidato accionable de la MISMA empresa (de Apollo O de Lusha)
      // en `pending_review` termina bien SIN arrancar Lusha Prospecting. Con ella
      // apagada —el default de código— esa protección no existe, y desde fuera el
      // resultado es indistinguible de que la puerta se evaluara sin acertar.
      //
      // `resolved` sale de `isContactEnrichmentLocalReuseGateEnabled()`, la MISMA
      // función que gobierna producción. Igual que el resto del endpoint: nombre y
      // booleanos, nunca el valor.
      contactEnrichmentLocalReuseGate: {
        flagName: CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG,
        configured: isContactEnrichmentLocalReuseGateFlagConfigured(),
        resolved: isContactEnrichmentLocalReuseGateEnabled(),
      },
      runtime_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

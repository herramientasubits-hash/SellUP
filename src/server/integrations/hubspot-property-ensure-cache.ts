// Agente 2A — Caché EN MEMORIA, por proceso, de "esta propiedad ya se confirmó que existe"
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// `ensureHubSpotSellUpCreatedProperty` es idempotente por diseño (GET antes de crear), pero
// wireada en cada creación de contacto/empresa eso es una llamada de red por cada aprobación,
// para siempre, para comprobar algo que sólo puede cambiar UNA vez en la vida de un portal de
// HubSpot: que el campo pasó de no existir a existir. Este módulo evita repetir esa llamada
// dentro del mismo proceso una vez confirmada.
//
// Deliberadamente NO es una caché durable (ni Supabase, ni Redis): un reinicio del proceso
// vuelve a comprobar una vez, que es barato y correcto, y evita el problema mucho más difícil de
// invalidar una caché durable si alguien borra el campo manualmente en el portal de HubSpot.

import {
  ensureHubSpotSellUpCreatedProperty,
  type EnsureHubSpotPropertyDeps,
  type EnsureHubSpotPropertyResult,
  type HubSpotSchemaObjectType,
} from './hubspot-property-ensure';

// Nota: dos llamadas concurrentes para el MISMO tipo de objeto, antes de que ninguna resuelva
// (dos contactos aprobados casi a la vez justo al arrancar el proceso), pueden las dos ver
// "aún no confirmado" y las dos tocar la red. Es una ventana estrecha, autosanable —la
// SIGUIENTE llamada ya encuentra el caché poblado— y su único efecto es que la que "pierde" la
// carrera puede quedar sin la marca `sellup_created` una vez. Nunca bloquea ni falla la
// creación del contacto/empresa. Aceptado a propósito: cachear la PROMESA en vuelo en vez del
// booleano resuelto evitaría esto, pero añadiría complejidad real para una ventana que se cierra
// sola tras el primer arranque.
const confirmedObjectTypes = new Set<HubSpotSchemaObjectType>();

/**
 * Igual que `ensureHubSpotSellUpCreatedProperty`, pero sólo hace la llamada de red la PRIMERA
 * vez (por tipo de objeto) que se confirma `ok: true` en este proceso. Un `ok: false` NUNCA se
 * cachea — un fallo (sin token, sin permiso de esquema, error de red) puede ser transitorio, y
 * cachear un fallo dejaría el campo sin crearse para siempre aunque el problema se resolviera.
 */
export async function ensureHubSpotSellUpCreatedPropertyCached(
  objectType: HubSpotSchemaObjectType,
  deps: EnsureHubSpotPropertyDeps,
): Promise<EnsureHubSpotPropertyResult> {
  if (confirmedObjectTypes.has(objectType)) return { ok: true, created: false };

  const result = await ensureHubSpotSellUpCreatedProperty(objectType, deps);
  if (result.ok) confirmedObjectTypes.add(objectType);
  return result;
}

/**
 * SÓLO para pruebas: vacía la caché module-level para que un test no dependa del orden de
 * ejecución ni del `objectType` elegido por otros tests. Nunca se llama desde código de
 * producción.
 */
export function resetHubSpotPropertyEnsureCacheForTests(): void {
  confirmedObjectTypes.clear();
}

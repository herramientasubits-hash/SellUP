// Agente 2A — Cableado REAL del motor de sincronización de contactos con HubSpot
// (AGENT2-CONTACT-HUBSPOT-AUTOSYNC-CUT3B)
//
// Hasta CUT-3A este cableado vivía dentro de `syncContactToHubSpot`, en `actions.ts`, porque
// sólo había un llamador: el botón manual. CUT-3B añade un segundo —la aprobación— y con él la
// pregunta de dónde vive la construcción de dependencias.
//
// La respuesta NO es duplicarla. Las lecturas de `contacts` y `accounts`, la escritura de
// `hubspot_contact_id` y la regla de OMITIR esa columna cuando el intento no produjo vínculo son
// decisiones finas que ya costaron cortes anteriores; dos copias divergirían, y la divergencia
// sería invisible hasta que un contacto autosincronizado perdiera su vínculo.
//
// Este módulo NO es `'use server'` a propósito: exporta un constructor de dependencias, y un
// fichero `'use server'` sólo puede exportar funciones asíncronas invocables desde el cliente
// (la lección de P0-R4). Vive aparte para que ambas server actions lo importen sin que ninguna
// tenga que exportar algo que no debería.
//
// Lo ÚNICO que cambia entre los dos llamadores es `method`. Todo lo demás es idéntico byte a
// byte, que es exactamente la propiedad que se quiere.

import { createClient } from '@/lib/supabase/server';
import { isHubSpotContactAutoPhoneUpdateEnabled } from '@/lib/feature-flags.server';
import {
  runContactHubSpotAutoPhoneUpdate,
  type ContactAutoPhoneUpdateReport,
} from './contact-hubspot-auto-phone-update-core';
import {
  runSyncContactToHubSpot,
  type AccountForSync,
  type ContactForSync,
  type SyncAuditEntry,
  type SyncContactDeps,
  type SyncContactToHubSpotResult,
} from './contact-hubspot-sync-core';
import type { HubSpotSyncMethod } from './contact-hubspot-sync-state';
import {
  getHubSpotContactSyncConnection,
  findHubSpotContactByEmail,
  createHubSpotContact,
  updateHubSpotContact,
  associateHubSpotContactWithCompany,
} from '@/server/integrations/hubspot-contact-sync';

/** Columnas del contacto que el motor necesita. Una sola definición para ambos llamadores. */
const CONTACT_FOR_SYNC_SELECT =
  'id, account_id, full_name, first_name, last_name, email, phone, mobile_phone, job_title, linkedin_url, hubspot_contact_id, metadata';

export interface ContactHubSpotSyncWiring {
  actorId: string;
  /** Lo ÚNICO que distingue al botón manual de la aprobación automática. */
  method: HubSpotSyncMethod;
  /** ISO del intento. Se inyecta para que el llamador use el MISMO reloj en toda su fase. */
  nowIso: string;
  logAudit?: (entry: SyncAuditEntry) => Promise<void>;
}

/**
 * Construye las dependencias reales del motor sobre el cliente del USUARIO.
 *
 * Deliberadamente NO usa el service role, ni siquiera en el camino automático: el autosync corre
 * inmediatamente después de que esa misma persona aprobara el candidato, sobre el contacto que
 * su aprobación acaba de crear. Escalar privilegios «porque es automático» ampliaría el alcance
 * de la sincronización a filas que el humano que la disparó no puede ver.
 */
export async function buildContactHubSpotSyncDeps(
  wiring: ContactHubSpotSyncWiring,
): Promise<SyncContactDeps> {
  const supabase = await createClient();

  return {
    actorId: wiring.actorId,
    nowIso: wiring.nowIso,
    method: wiring.method,

    loadContact: async (id): Promise<ContactForSync | null> => {
      const { data, error } = await supabase
        .from('contacts')
        .select(CONTACT_FOR_SYNC_SELECT)
        .eq('id', id)
        .is('archived_at', null)
        .maybeSingle();
      if (error || !data) return null;
      return {
        ...(data as unknown as ContactForSync),
        metadata: (data.metadata as Record<string, unknown> | null) ?? {},
      };
    },

    loadAccount: async (accountId): Promise<AccountForSync | null> => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, name, hubspot_company_id')
        .eq('id', accountId)
        .maybeSingle();
      if (error || !data) return null;
      return data as unknown as AccountForSync;
    },

    checkConnection: getHubSpotContactSyncConnection,
    findHubSpotContactByEmail,
    createHubSpotContact,
    // CUT-2 — PATCH sobre el id durable. Dependencia separada de la creación a propósito.
    updateHubSpotContact,
    associateContactWithCompany: associateHubSpotContactWithCompany,

    persistSync: async (id, patch) => {
      // `hubspot_contact_id` sólo viaja cuando el intento produjo vínculo. En los intentos
      // bloqueados o fallidos se OMITE la columna en vez de escribir `null`: un `null`
      // explícito borraría un vínculo existente para registrar un estado.
      const { error } = await supabase
        .from('contacts')
        .update({
          ...(patch.hubspot_contact_id !== null
            ? { hubspot_contact_id: patch.hubspot_contact_id }
            : {}),
          metadata: patch.metadata,
          updated_by: wiring.actorId,
        })
        .eq('id', id);
      return { error: error?.message };
    },

    logAudit: wiring.logAudit,
  };
}

/**
 * Escribe SÓLO `metadata` sobre un contacto. Lo usa el anexo operativo del autosync, que por
 * contrato no puede tocar el vínculo ni ninguna otra columna.
 */
export async function persistContactMetadata(
  contactId: string,
  metadata: Record<string, unknown>,
  actorId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('contacts')
    .update({ metadata, updated_by: actorId })
    .eq('id', contactId);
  return { error: error?.message };
}

/** Atajo para el llamador que sólo quiere ejecutar el motor con el cableado real. */
export async function runContactHubSpotSyncWired(
  contactId: string,
  wiring: ContactHubSpotSyncWiring,
): Promise<SyncContactToHubSpotResult> {
  return runSyncContactToHubSpot(contactId, await buildContactHubSpotSyncDeps(wiring));
}

// ── CUT-3C · EL entrypoint del PATCH automático ────────────────
//
// UNO, y sólo uno, para los tres caminos disparadores. Vive aquí y no en cada server action por
// la misma razón que `buildContactHubSpotSyncDeps`: las decisiones finas —qué columnas se
// releen, que el anexo no pueda tocar el vínculo, que el motor reciba `method: 'auto'`— ya
// costaron cortes anteriores, y dos copias divergirían de forma invisible hasta que un contacto
// automático perdiera su vínculo o una erasure acabara exportada.
//
// Es también el ÚNICO sitio que lee la bandera. Los llamadores no la conocen: así no existe una
// segunda forma de encenderla, y un camino nuevo no puede olvidarse de comprobarla porque no
// tiene con qué.

export interface ContactHubSpotAutoPhoneUpdateWiring {
  actorId: string;
  /** ISO del intento. Se inyecta para que el llamador use el MISMO reloj en toda su fase. */
  nowIso: string;
  logAudit?: (entry: SyncAuditEntry) => Promise<void>;
}

/**
 * Ejecuta el PATCH automático con el cableado real. NUNCA lanza (ver el core).
 *
 * El cliente es el del USUARIO, igual que en el autosync y por la misma razón: esto corre justo
 * después de que esa persona guardara un teléfono, sobre el contacto que su escritura acaba de
 * tocar. Escalar a service role «porque es automático» ampliaría el alcance a filas que el
 * humano que lo disparó no puede ver.
 */
export async function runContactHubSpotAutoPhoneUpdateWired(
  contactId: string,
  wiring: ContactHubSpotAutoPhoneUpdateWiring,
): Promise<ContactAutoPhoneUpdateReport> {
  return runContactHubSpotAutoPhoneUpdate(contactId, {
    enabled: isHubSpotContactAutoPhoneUpdateEnabled(),
    nowIso: wiring.nowIso,

    // Se RELEE la fila en vez de confiar en el payload que se acaba de escribir: el portero
    // decide sobre el estado DURABLE, y entre la escritura y este punto la fila pudo cambiar
    // —una erasure concurrente, otra pestaña que ya pulsó «Actualizar»—. Releer es lo que hace
    // que el veredicto describa la base de datos y no la intención del llamador.
    //
    // El cliente se construye AQUÍ DENTRO y no arriba: con la bandera apagada el core sale antes
    // de llamar a nada, así que no debe quedar ni un `createClient()` ejecutándose por cada
    // guardado de contacto. «Apagada equivale a CUT-3B» pasa a ser cierto por construcción en vez
    // de por aproximación.
    loadSubject: async (id) => {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from('contacts')
        .select('id, hubspot_contact_id, metadata')
        .eq('id', id)
        .is('archived_at', null)
        .maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id as string,
        hubspot_contact_id: (data.hubspot_contact_id as string | null) ?? null,
        metadata: (data.metadata as Record<string, unknown> | null) ?? {},
      };
    },

    // EL MISMO motor que el botón manual, con la ÚNICA diferencia declarada: `auto`.
    runSync: async (id) =>
      runSyncContactToHubSpot(
        id,
        await buildContactHubSpotSyncDeps({
          actorId: wiring.actorId,
          nowIso: wiring.nowIso,
          method: 'auto',
          logAudit: wiring.logAudit,
        }),
      ),

    // `persistContactMetadata` construye su propio cliente, así que tampoco arrastra uno.
    persistAnnex: async (id, metadata) => persistContactMetadata(id, metadata, wiring.actorId),
  });
}

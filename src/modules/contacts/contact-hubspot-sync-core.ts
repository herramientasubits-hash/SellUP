// Agente 2A — Contact HubSpot Sync Core (Hito 17A.4C)
//
// Lógica pura y orquestación inyectable para sincronizar manualmente un contacto
// aprobado de SellUp hacia HubSpot. Sin red, sin DB, sin auth: las dependencias
// se inyectan para poder testear sin Supabase ni HubSpot. La server action
// (actions.ts) cablea las implementaciones reales sobre estos contratos.
//
// Reglas del hito:
//  - Sincronización MANUAL, controlada, uno a uno, desde un contacto aprobado.
//  - NUNCA automática al aprobar. NUNCA bulk. NUNCA crea empresas/deals/notas.
//  - Requiere email, account_id y que la cuenta tenga hubspot_company_id.
//  - Si ya existe contacto en HubSpot por email → vincular, no duplicar.
//  - NUNCA llama a Apollo ni toca candidatos.

import {
  HUBSPOT_SYNC_ERROR_CODES,
  clearedHubSpotSyncBaselineExtras,
  hasPendingHubSpotPhoneChange,
  preservePendingHubSpotPhoneChange,
  readHubSpotSyncState,
  resolveOutboundHubSpotPhone,
  writeHubSpotSyncState,
  type HubSpotSyncMethod,
  type HubSpotSyncState,
} from './contact-hubspot-sync-state';

// ── Entrada/proyección de datos ─────────────────────────────────

export interface ContactForSync {
  id: string;
  account_id: string | null;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  hubspot_contact_id: string | null;
  metadata: Record<string, unknown>;
}

export interface AccountForSync {
  id: string;
  name: string | null;
  hubspot_company_id: string | null;
}

/** Estado mínimo de la conexión HubSpot necesario para escribir contactos. */
export interface HubSpotSyncConnection {
  connected: boolean;
  /** crm.objects.contacts.write disponible (o scopes no declarados → se intenta). */
  canWriteContacts: boolean;
}

/** Propiedades estándar y seguras enviadas a HubSpot al crear un contacto. */
export interface HubSpotContactCreateInput {
  email: string;
  firstname: string | null;
  lastname: string | null;
  jobtitle: string | null;
  phone: string | null;
}

/**
 * Propiedades enviadas al ACTUALIZAR un contacto ya vinculado (CUT-2 · CUT-3A).
 *
 * Un solo campo, y no por falta de tiempo: `phone` es el único cuyo mapeo está validado en
 * este corte. `email` es además la IDENTIDAD con la que se buscó el contacto —reescribirlo por
 * un PATCH podría fusionar o desviar la ficha del CRM del cliente—, así que queda fuera hasta
 * que exista un contrato que diga qué hacer cuando cambia.
 *
 * CUT-3A hace `phone` NULABLE, y `null` significa BORRAR la propiedad en HubSpot. Se modela
 * como ausencia y no como cadena vacía a propósito: la cadena vacía es la representación que
 * HubSpot exige EN EL CABLE, y dejarla entrar en el dominio obligaría a cada llamador a
 * recordarla —y a alguno se le olvidaría, enviando `""` donde quería un número o al revés. La
 * traducción vive en UN solo sitio: `buildHubSpotContactUpdateProperties`.
 */
export interface HubSpotContactUpdateInput {
  phone: string | null;
}

/**
 * LA representación canónica del PATCH en el cable. Única y exportada para que las pruebas
 * afirmen el cuerpo EXACTO y para que el adaptador no pueda inventar una segunda.
 *
 * HubSpot borra una propiedad recibiéndola como CADENA VACÍA; omitirla del objeto `properties`
 * no la borra, la deja como estaba. Por eso `null` se traduce a `''` y nunca a una omisión: un
 * borrado que se representara omitiendo el campo sería un no-op silencioso, y el contacto
 * seguiría diciendo `synced` sobre un número que HubSpot conserva.
 */
export function buildHubSpotContactUpdateProperties(
  input: HubSpotContactUpdateInput,
): { phone: string } {
  return { phone: input.phone ?? '' };
}

export type CompanyAssociationStatus = 'associated' | 'failed';

/**
 * Patch que se persiste localmente tras un intento de sincronización.
 *
 * `hubspot_contact_id` es `null` cuando el intento NO produjo vínculo (bloqueado o fallido) y
 * lo único que hay que escribir es el estado durable. El escritor debe OMITIR la columna en
 * ese caso, nunca escribir `null` sobre un vínculo existente.
 */
export interface ContactHubSpotSyncPatch {
  hubspot_contact_id: string | null;
  metadata: Record<string, unknown>;
}

// ── Resultado ───────────────────────────────────────────────────

export type SyncContactToHubSpotResult =
  | {
      ok: true;
      status: 'created' | 'linked_existing' | 'already_synced' | 'updated';
      hubspotContactId: string;
      message: string;
    }
  | {
      ok: false;
      errorCode:
        | 'CONTACT_NOT_FOUND'
        | 'MISSING_EMAIL'
        | 'MISSING_ACCOUNT'
        | 'MISSING_HUBSPOT_COMPANY'
        | 'HUBSPOT_NOT_CONNECTED'
        | 'HUBSPOT_SCOPE_MISSING'
        | 'HUBSPOT_ERROR'
        | 'UNKNOWN_ERROR';
      message: string;
    };

export const SYNC_MESSAGES = {
  contactNotFound: 'No se encontró el contacto.',
  missingEmail: 'No se puede sincronizar: el contacto no tiene email.',
  missingAccount: 'No se puede sincronizar: el contacto no está asociado a una cuenta.',
  missingCompany:
    'No se puede sincronizar: la cuenta no tiene empresa vinculada en HubSpot.',
  notConnected: 'No se puede sincronizar: HubSpot no está conectado.',
  scopeMissing:
    'No se puede sincronizar: la conexión de HubSpot no tiene permiso para escribir contactos.',
  hubspotError: 'No fue posible sincronizar el contacto con HubSpot.',
  localLinkFailed:
    'El contacto se sincronizó en HubSpot pero no se pudo guardar el vínculo en SellUp.',
  created: 'Contacto creado en HubSpot y vinculado a SellUp.',
  linkedExisting: 'Contacto existente en HubSpot vinculado a SellUp.',
  alreadySynced: 'Este contacto ya estaba sincronizado con HubSpot.',
  updated: 'Teléfono actualizado en HubSpot.',
  // CUT-3A: borrar tiene su propio mensaje. «Actualizado» sobre un borrado le diría a la
  // persona que envió un número cuando lo que hizo fue quitarlo.
  cleared: 'Teléfono eliminado en HubSpot.',
  hubspotUpdateError: 'No fue posible actualizar el contacto en HubSpot.',
  localStateFailed:
    'El teléfono se actualizó en HubSpot pero no se pudo guardar el estado en SellUp.',
} as const;

// ── Helpers puros ───────────────────────────────────────────────

export function sanitizeEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string' || !email.trim()) return null;
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Deriva firstname/lastname para HubSpot. Usa los campos explícitos del contacto;
 * si faltan, parte `full_name` (primer token = nombre, resto = apellido).
 */
export function splitContactName(contact: ContactForSync): {
  firstname: string | null;
  lastname: string | null;
} {
  const first = cleanString(contact.first_name);
  const last = cleanString(contact.last_name);
  if (first || last) return { firstname: first, lastname: last };

  const full = cleanString(contact.full_name);
  if (!full) return { firstname: null, lastname: null };
  const parts = full.split(/\s+/);
  if (parts.length === 1) return { firstname: parts[0], lastname: null };
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') };
}

/**
 * Construye las propiedades estándar y seguras para crear un contacto en HubSpot.
 * Se omite LinkedIn deliberadamente (sin mapeo de escritura validado en este hito):
 * se conserva solo en SellUp.
 */
export function buildHubSpotContactProperties(
  contact: ContactForSync,
  email: string,
): HubSpotContactCreateInput {
  const { firstname, lastname } = splitContactName(contact);
  return {
    email,
    firstname,
    lastname,
    jobtitle: cleanString(contact.job_title),
    // La MISMA autoridad que decide si el contacto quedó desactualizado (CUT-2). Dos reglas
    // separadas para «qué se envía» y «qué cuenta como cambio» divergen en cuanto una cambie.
    phone: resolveOutboundHubSpotPhone(contact),
  };
}

/**
 * Construye la metadata de un intento EXITOSO preservando el resto.
 *
 * Escribe el estado durable del CUT-1 (`status`/`method`/`attempted_at`/`last_error`/
 * `hubspot_contact_id`) a través de la única autoridad que lo define, y conserva junto a él
 * los campos de auditoría que este flujo ya escribía desde 17A.4C (`synced_at`, `synced_by`,
 * `mode`, `hubspot_company_id`, `company_association`), que la UI sigue leyendo.
 */
export function buildSyncMetadata(args: {
  existing: Record<string, unknown> | null | undefined;
  hubspotContactId: string;
  mode: 'created' | 'linked_existing';
  hubspotCompanyId: string;
  companyAssociation: CompanyAssociationStatus;
  actorId: string;
  nowIso: string;
  /** CUT-3B — procedencia del intento. Se EXIGE: adivinarla la falsificaría. */
  method: HubSpotSyncMethod;
}): Record<string, unknown> {
  const {
    existing,
    hubspotContactId,
    mode,
    hubspotCompanyId,
    companyAssociation,
    actorId,
    nowIso,
    method,
  } = args;
  return writeHubSpotSyncState(
    existing,
    {
      status: 'synced',
      // CUT-1 sólo podía escribir `manual` porque no existía otro origen. CUT-3B pasa la
      // procedencia del intento REAL: un vínculo creado por el autosync no puede quedar
      // registrado como si alguien lo hubiera pulsado.
      method,
      attempted_at: nowIso,
      last_error: null,
      hubspot_contact_id: hubspotContactId,
      // Un vínculo recién creado no arrastra nada pendiente: lo que hay en HubSpot es
      // exactamente lo que se acaba de enviar.
      stale_since: null,
      stale_reason: null,
      // CUT-3C — sin pendiente no hay causante. Escribir aquí la procedencia del último
      // pendiente resuelto dejaría una atribución huérfana que el ejecutor podría releer.
      stale_source: null,
    },
    {
      synced_at: nowIso,
      synced_by: actorId,
      mode,
      hubspot_company_id: hubspotCompanyId,
      company_association: companyAssociation,
      // BACKFILL LEGACY — este intento SÍ ocurrió: hubo petición y hubo respuesta. La
      // anotación de línea base advertía de lo contrario, así que se borra. No se borra en el
      // camino fallido: un rechazo de HubSpot no observó nada.
      ...clearedHubSpotSyncBaselineExtras(),
    },
  );
}

/**
 * Construye la metadata de un intento manual que NO produjo vínculo: bloqueado por falta de
 * email o de empresa HubSpot, o fallido en HubSpot.
 *
 * No borra el bloque anterior: lo sobrescribe campo a campo con lo que este intento sí sabe.
 * `hubspot_contact_id` queda `null` porque no hay vínculo que afirmar.
 */
export function buildFailedSyncMetadata(args: {
  existing: Record<string, unknown> | null | undefined;
  status: Extract<
    HubSpotSyncState['status'],
    'blocked_no_email' | 'blocked_no_hubspot_company' | 'failed'
  >;
  lastError: string | null;
  nowIso: string;
  /** CUT-3B — la misma exigencia que en el camino exitoso, y por la misma razón. */
  method: HubSpotSyncMethod;
}): Record<string, unknown> {
  return writeHubSpotSyncState(args.existing, {
    status: args.status,
    method: args.method,
    attempted_at: args.nowIso,
    last_error: args.lastError,
    hubspot_contact_id: null,
    // CUT-2: los marcadores de pendiente SOBREVIVEN al intento fallido. `failed` cuenta que el
    // último intento no entró; `stale_reason` cuenta que todavía hay un teléfono local sin
    // enviar. Son dos hechos distintos y perder el segundo dejaría al humano sin saber que
    // reintentar sigue teniendo algo que hacer.
    ...preservePendingHubSpotPhoneChange(args.existing),
  });
}

/**
 * Metadata de un PATCH EXITOSO sobre un contacto ya vinculado (CUT-2).
 *
 * Vuelve a `synced` y LIMPIA los marcadores de pendiente porque ya no hay nada pendiente: lo
 * que estaba local acaba de viajar. El `hubspot_contact_id` se conserva —el PATCH no crea ni
 * revincula nada— y `synced_at` se refresca porque esta vez sí hubo escritura en HubSpot.
 */
export function buildUpdatedSyncMetadata(args: {
  existing: Record<string, unknown> | null | undefined;
  hubspotContactId: string;
  actorId: string;
  nowIso: string;
  /** CUT-3B — igual que los otros dos constructores. El PATCH automático no existe todavía,
   *  pero el constructor no es quien decide eso: quien lo decide es el portero del autosync. */
  method: HubSpotSyncMethod;
}): Record<string, unknown> {
  return writeHubSpotSyncState(
    args.existing,
    {
      status: 'synced',
      method: args.method,
      attempted_at: args.nowIso,
      last_error: null,
      hubspot_contact_id: args.hubspotContactId,
      stale_since: null,
      stale_reason: null,
      // CUT-3C — los TRES marcadores se limpian juntos. Dejar la procedencia puesta sobre un
      // `synced` haría que la ficha siguiera afirmando un causante para un pendiente que ya no
      // existe, y el ejecutor automático la leería como si quedara algo por enviar.
      stale_source: null,
    },
    {
      synced_at: args.nowIso,
      synced_by: args.actorId,
      // `mode` NO se reescribe: describe cómo se obtuvo el vínculo (`created`/`linked_existing`)
      // y un PATCH no lo cambia. `hubspot_company_id` y `company_association` tampoco — CUT-2 no
      // reintenta la asociación, así que anunciar una nueva afirmaría algo que no ocurrió.
      // `writeHubSpotSyncState` los conserva del bloque anterior por sí solo.
      //
      // BACKFILL LEGACY — la línea base SÍ se borra. Este PATCH es la primera vez que este
      // sistema observa a HubSpot aceptar el teléfono de este contacto, y desde aquí el
      // `synced` deja de ser deducido de la existencia del vínculo. Es exactamente el alcance
      // que la anotación tenía: el eje que consume el estado durable es el del TELÉFONO.
      ...clearedHubSpotSyncBaselineExtras(),
    },
  );
}

// ── Dependencias inyectables ────────────────────────────────────

export interface SyncAuditEntry {
  contactId: string;
  accountId: string;
  actorUserId: string | null;
  hubspotContactId: string;
  /** `null` en un PATCH: la empresa no participa en la actualización. */
  hubspotCompanyId: string | null;
  mode: 'created' | 'linked_existing' | 'updated';
  /** `null` en un PATCH: CUT-2 no reintenta la asociación, así que no afirma nada sobre ella. */
  companyAssociation: CompanyAssociationStatus | null;
}

export interface SyncContactDeps {
  actorId: string;
  nowIso: string;
  /**
   * CUT-3B — procedencia del intento, OBLIGATORIA.
   *
   * No tiene valor por defecto a propósito. Un `method` opcional que cayera en `'manual'`
   * convertiría un olvido del cableado en una mentira durable —«lo sincronizó una persona»—
   * que nadie detectaría leyendo la ficha. Al ser obligatorio, el compilador exige que cada
   * llamador declare quién disparó el intento.
   */
  method: HubSpotSyncMethod;
  loadContact: (id: string) => Promise<ContactForSync | null>;
  loadAccount: (accountId: string) => Promise<AccountForSync | null>;
  checkConnection: () => Promise<HubSpotSyncConnection>;
  findHubSpotContactByEmail: (email: string) => Promise<{ id: string } | null>;
  createHubSpotContact: (
    input: HubSpotContactCreateInput,
  ) => Promise<{ id: string } | { error: string }>;
  /**
   * CUT-2 — PATCH sobre un contacto YA vinculado. Se inyecta aparte de `createHubSpotContact`
   * para que ninguna rama pueda crear cuando quería actualizar.
   */
  updateHubSpotContact: (
    hubspotContactId: string,
    input: HubSpotContactUpdateInput,
  ) => Promise<{ ok: true } | { error: string }>;
  associateContactWithCompany: (
    hubspotContactId: string,
    hubspotCompanyId: string,
  ) => Promise<{ ok: true } | { error: string }>;
  persistSync: (
    contactId: string,
    patch: ContactHubSpotSyncPatch,
  ) => Promise<{ error?: string }>;
  logAudit?: (entry: SyncAuditEntry) => Promise<void>;
}

// ── Orquestación ────────────────────────────────────────────────

/**
 * Sincroniza un contacto aprobado de SellUp con HubSpot:
 *  1. Valida contacto, email, cuenta y empresa HubSpot de la cuenta.
 *  2. Valida conexión y scope de escritura de contactos.
 *  3. Si ya tiene hubspot_contact_id, decide por la EVIDENCIA escrita (CUT-2 · CUT-3A):
 *       - cambio local pendiente  → PATCH sobre el id durable, escribiendo el teléfono actual
 *                                   o BORRANDO la propiedad si ya no hay ninguno;
 *       - estado ilegible/legacy  → reparación del estado, SIN PATCH;
 *       - `synced` y nada pendiente → already_synced, sin escritura y sin red.
 *  4. Busca por email: si existe → vincula; si no → crea (sin duplicar).
 *  5. Asocia el contacto a la empresa HubSpot (best-effort, no fatal).
 *  6. Persiste hubspot_contact_id + metadata.hubspot_sync localmente.
 *
 * NO crea empresas/deals/notas. NO llama a Apollo. NO toca candidatos. El PATCH no busca por
 * email, no crea y no reintenta asociaciones: su única identidad es el id durable.
 */
export async function runSyncContactToHubSpot(
  contactId: string,
  deps: SyncContactDeps,
): Promise<SyncContactToHubSpotResult> {
  if (typeof contactId !== 'string' || !contactId.trim()) {
    return { ok: false, errorCode: 'CONTACT_NOT_FOUND', message: SYNC_MESSAGES.contactNotFound };
  }

  const contact = await deps.loadContact(contactId.trim());
  if (!contact) {
    return { ok: false, errorCode: 'CONTACT_NOT_FOUND', message: SYNC_MESSAGES.contactNotFound };
  }

  /**
   * Persiste el estado durable de un intento que no dejó vínculo. Es BEST-EFFORT a propósito:
   * el veredicto que se le devuelve al humano es el del intento, no el de su registro. Si la
   * escritura del estado falla, el error que se reporta sigue siendo el real —el que el humano
   * puede actuar— en vez de sustituirlo por uno de base de datos que no explica nada.
   */
  const recordBlockedOrFailed = async (
    status: 'blocked_no_email' | 'blocked_no_hubspot_company' | 'failed',
    lastError: string | null,
  ): Promise<void> => {
    try {
      await deps.persistSync(contact.id, {
        hubspot_contact_id: null,
        metadata: buildFailedSyncMetadata({
          existing: contact.metadata,
          status,
          lastError,
          nowIso: deps.nowIso,
          method: deps.method,
        }),
      });
    } catch {
      // Ver arriba: registrar el estado no puede convertirse en el fallo reportado.
    }
  };

  const email = sanitizeEmail(contact.email);
  if (!email) {
    await recordBlockedOrFailed('blocked_no_email', null);
    return { ok: false, errorCode: 'MISSING_EMAIL', message: SYNC_MESSAGES.missingEmail };
  }

  // MISSING_ACCOUNT no tiene estado en el vocabulario del CUT-1 y no se inventa uno: un
  // contacto sin cuenta no está «bloqueado por HubSpot», está incompleto en SellUp. El estado
  // anterior se queda como estaba en vez de mentir sobre la causa.
  if (!contact.account_id) {
    return { ok: false, errorCode: 'MISSING_ACCOUNT', message: SYNC_MESSAGES.missingAccount };
  }

  // ── Contacto YA vinculado ─────────────────────────────────────
  // Tres desenlaces distintos, y la diferencia entre ellos es la EVIDENCIA que hay escrita:
  //   B) hay un cambio local pendiente  → PATCH (CUT-2);
  //   D) no hay estado durable legible  → reparación del CUT-1, NUNCA un PATCH;
  //   C) el estado ya dice `synced`     → nada que hacer, cero escrituras y cero red.
  // Se evalúa antes de tocar cuenta/empresa para que sea independiente del estado HubSpot.
  if (cleanString(contact.hubspot_contact_id)) {
    const hubspotContactId = contact.hubspot_contact_id as string;
    const priorState = readHubSpotSyncState(contact.metadata);

    // ── B — Actualizar lo que cambió localmente ──────────────────
    if (hasPendingHubSpotPhoneChange(priorState)) {
      // La conexión se comprueba AQUÍ y no antes: sin ella no hay PATCH posible. Igual que en
      // el alta, un workspace desconectado NO ensucia el estado del contacto —es una condición
      // del workspace— y el marcador de pendiente sobrevive intacto para el siguiente intento.
      const updateConnection = await deps.checkConnection();
      if (!updateConnection.connected) {
        return {
          ok: false,
          errorCode: 'HUBSPOT_NOT_CONNECTED',
          message: SYNC_MESSAGES.notConnected,
        };
      }
      if (!updateConnection.canWriteContacts) {
        return {
          ok: false,
          errorCode: 'HUBSPOT_SCOPE_MISSING',
          message: SYNC_MESSAGES.scopeMissing,
        };
      }

      // El teléfono se relee de la FILA, no del marcador: entre marcar y pulsar pudo cambiar
      // otra vez —o desaparecer—, y lo que debe viajar es lo que hay AHORA. La razón guardada
      // no decide el cuerpo: si mandara, un `phone_changed` obsoleto enviaría un número que ya
      // no existe y un `phone_removed` obsoleto BORRARÍA en HubSpot uno que sí existe.
      //
      // CUT-3A: `null` ya no es un motivo para negarse. Es la operación de BORRADO, y el
      // adaptador tiene UNA representación canónica para ella.
      const outboundPhone = resolveOutboundHubSpotPhone(contact);

      const updateResult = await deps.updateHubSpotContact(hubspotContactId, {
        phone: outboundPhone,
      });

      if ('error' in updateResult) {
        // `failed` + marcadores conservados: el intento falló Y el teléfono sigue sin viajar.
        await recordBlockedOrFailed('failed', HUBSPOT_SYNC_ERROR_CODES.hubspotUpdateFailed);
        return {
          ok: false,
          errorCode: 'HUBSPOT_ERROR',
          message: SYNC_MESSAGES.hubspotUpdateError,
        };
      }

      const persistUpdate = await deps.persistSync(contact.id, {
        // Se OMITE la columna: el vínculo ya está en la fila y el PATCH no lo cambió.
        hubspot_contact_id: null,
        metadata: buildUpdatedSyncMetadata({
          existing: contact.metadata,
          hubspotContactId,
          actorId: deps.actorId,
          nowIso: deps.nowIso,
          method: deps.method,
        }),
      });
      if (persistUpdate.error) {
        // HubSpot SÍ quedó al día pero SellUp no pudo anotarlo. Se deja el pendiente puesto: el
        // siguiente clic vuelve a enviar el MISMO número —un PATCH idempotente— y converge.
        // Limpiar la marca aquí afirmaría un estado que la fila no respalda.
        await recordBlockedOrFailed('failed', HUBSPOT_SYNC_ERROR_CODES.localStateFailed);
        return { ok: false, errorCode: 'UNKNOWN_ERROR', message: SYNC_MESSAGES.localStateFailed };
      }

      await deps.logAudit?.({
        contactId: contact.id,
        accountId: contact.account_id,
        actorUserId: deps.actorId,
        hubspotContactId,
        hubspotCompanyId: null,
        mode: 'updated',
        companyAssociation: null,
      });

      return {
        ok: true,
        status: 'updated',
        hubspotContactId,
        message: outboundPhone === null ? SYNC_MESSAGES.cleared : SYNC_MESSAGES.updated,
      };
    }

    // ── D — Reparación, no un segundo intento ────────────────────
    // El vínculo existe pero el estado durable NO dice `synced` —un contacto vinculado por otra
    // vía, o anterior a este contrato—: se corrige el estado y NO se hace PATCH, porque no hay
    // ninguna evidencia escrita de que algo local esté sin enviar. Un PATCH aquí enviaría el
    // teléfono actual «por si acaso», sobrescribiendo en HubSpot un dato que quizá es mejor.
    if (priorState?.status !== 'synced') {
      try {
        await deps.persistSync(contact.id, {
          hubspot_contact_id: null,
          metadata: writeHubSpotSyncState(contact.metadata, {
            status: 'synced',
            // Se conserva la procedencia del intento anterior si la había. Este clic no
            // intentó nada: no estampa una hora nueva sobre la que ya estaba escrita.
            method: priorState?.method ?? null,
            attempted_at: priorState?.attempted_at ?? null,
            last_error: null,
            hubspot_contact_id: hubspotContactId,
            // Se arrastran tal cual. Un estado ilegible no autoriza a declarar que no hay nada
            // pendiente, igual que no autoriza a enviar nada.
            ...preservePendingHubSpotPhoneChange(contact.metadata),
          }),
        });
      } catch {
        // Best-effort: el contacto SÍ está sincronizado y eso es lo que se reporta.
      }
    }

    // ── C — Ya sincronizado y sin nada pendiente ─────────────────
    // CERO escrituras y CERO red: reescribir pisaría el `attempted_at` del intento que de
    // verdad creó el vínculo con la hora de una consulta.
    return {
      ok: true,
      status: 'already_synced',
      hubspotContactId,
      message: SYNC_MESSAGES.alreadySynced,
    };
  }

  const account = await deps.loadAccount(contact.account_id);
  const hubspotCompanyId = cleanString(account?.hubspot_company_id);
  if (!hubspotCompanyId) {
    await recordBlockedOrFailed('blocked_no_hubspot_company', null);
    return {
      ok: false,
      errorCode: 'MISSING_HUBSPOT_COMPANY',
      message: SYNC_MESSAGES.missingCompany,
    };
  }

  // Ni `HUBSPOT_NOT_CONNECTED` ni `HUBSPOT_SCOPE_MISSING` tocan el estado del contacto: son
  // condiciones del WORKSPACE, iguales para todos los contactos, y escribirlas como `failed`
  // en cada ficha culparía al contacto de una configuración que no es suya —y dejaría cientos
  // de estados falsos que nadie limpiaría al reconectar HubSpot.
  const connection = await deps.checkConnection();
  if (!connection.connected) {
    return { ok: false, errorCode: 'HUBSPOT_NOT_CONNECTED', message: SYNC_MESSAGES.notConnected };
  }
  if (!connection.canWriteContacts) {
    return { ok: false, errorCode: 'HUBSPOT_SCOPE_MISSING', message: SYNC_MESSAGES.scopeMissing };
  }

  // Buscar por email para no duplicar.
  let hubspotContactId: string;
  let mode: 'created' | 'linked_existing';

  // La búsqueda FALLA CERRADO: si no se pudo comprobar si el contacto ya existe en HubSpot,
  // crear sería apostar a que no, y el precio de perder esa apuesta es un contacto duplicado en
  // el CRM del cliente que nadie pidió y que hay que fusionar a mano.
  //
  // CUT-3B además lo REGISTRA. Hasta aquí la excepción escapaba del motor entera y la recogía
  // el `catch` de la server action, que devolvía el error a la persona que estaba mirando: con
  // alguien delante bastaba. El autosync no tiene a nadie delante, así que un fallo que no deja
  // rastro es un contacto que dice «Nunca sincronizado» sin que nadie sepa que sí se intentó.
  let existing: { id: string } | null;
  try {
    existing = await deps.findHubSpotContactByEmail(email);
  } catch {
    await recordBlockedOrFailed('failed', HUBSPOT_SYNC_ERROR_CODES.hubspotSearchFailed);
    return { ok: false, errorCode: 'HUBSPOT_ERROR', message: SYNC_MESSAGES.hubspotError };
  }

  if (existing) {
    hubspotContactId = existing.id;
    mode = 'linked_existing';
  } else {
    const createResult = await deps.createHubSpotContact(
      buildHubSpotContactProperties(contact, email),
    );
    if ('error' in createResult) {
      // Falló la creación en HubSpot → no marcamos como sincronizado. El código guardado es
      // MECÁNICO: el mensaje del proveedor cita las propiedades enviadas y una de ellas es el
      // email del contacto.
      await recordBlockedOrFailed('failed', HUBSPOT_SYNC_ERROR_CODES.hubspotCreateFailed);
      return { ok: false, errorCode: 'HUBSPOT_ERROR', message: SYNC_MESSAGES.hubspotError };
    }
    hubspotContactId = createResult.id;
    mode = 'created';
  }

  // Asociar a la empresa HubSpot de la cuenta (best-effort: el contacto ya existe
  // en HubSpot, así que un fallo de asociación no invalida el vínculo).
  const assocResult = await deps.associateContactWithCompany(hubspotContactId, hubspotCompanyId);
  const companyAssociation: CompanyAssociationStatus =
    'ok' in assocResult ? 'associated' : 'failed';

  // Persistir vínculo local + trazabilidad.
  const metadata = buildSyncMetadata({
    existing: contact.metadata,
    hubspotContactId,
    mode,
    hubspotCompanyId,
    companyAssociation,
    actorId: deps.actorId,
    nowIso: deps.nowIso,
    method: deps.method,
  });
  const persistResult = await deps.persistSync(contact.id, { hubspot_contact_id: hubspotContactId, metadata });
  if (persistResult.error) {
    // El contacto SÍ quedó en HubSpot pero SellUp no pudo guardar el vínculo. Se intenta dejar
    // constancia del fallo; si esa segunda escritura tampoco entra, el estado se queda como
    // estaba, que es preferible a afirmar un `synced` que la fila no respalda.
    await recordBlockedOrFailed('failed', HUBSPOT_SYNC_ERROR_CODES.localLinkFailed);
    return { ok: false, errorCode: 'UNKNOWN_ERROR', message: SYNC_MESSAGES.localLinkFailed };
  }

  await deps.logAudit?.({
    contactId: contact.id,
    accountId: contact.account_id,
    actorUserId: deps.actorId,
    hubspotContactId,
    hubspotCompanyId,
    mode,
    companyAssociation,
  });

  return {
    ok: true,
    status: mode,
    hubspotContactId,
    message: mode === 'created' ? SYNC_MESSAGES.created : SYNC_MESSAGES.linkedExisting,
  };
}

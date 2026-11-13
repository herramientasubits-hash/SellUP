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
  mobilePhone: string | null;
  /**
   * AGENT2A-HUBSPOT-ALL-PHONES-CREATE-LINK: números adicionales de la colección del contacto que
   * caen en `company_phone` / `telefono_alterno` según `planRevealedPhonesForHubSpot`. Opcionales
   * (ausente = no viaja); el escritor descarta además cualquier campo APAGADO.
   */
  companyPhone?: string | null;
  alternatePhone?: string | null;
  /**
   * URL del perfil de LinkedIn → propiedad `hs_linkedin_url` de HubSpot.
   *
   * AGENT2A-HUBSPOT-LINKEDIN-ON-CREATE: hasta este corte el LinkedIn sólo viajaba cuando el
   * contacto YA existía en HubSpot (completar vacíos), así que todo contacto CREADO por SellUp
   * llegaba al CRM sin él. El mapeo `hs_linkedin_url` ya estaba validado por ese camino.
   * La URL viaja tal cual se guardó (p. ej. `…/herrerani%C3%B1o`): el percent-encoding de
   * caracteres como la ñ es la forma canónica de la URL y LinkedIn la resuelve igual.
   */
  linkedinUrl: string | null;
}

/**
 * Propiedades enviadas al ACTUALIZAR un contacto ya vinculado (CUT-2 · CUT-3A).
 *
 * `phone` y `mobilePhone` (AGENT2A) son los únicos campos cuyo mapeo está validado en este
 * corte. `email` es además la IDENTIDAD con la que se buscó el contacto —reescribirlo por
 * un PATCH podría fusionar o desviar la ficha del CRM del cliente—, así que queda fuera hasta
 * que exista un contrato que diga qué hacer cuando cambia.
 *
 * CUT-3A hace `phone` NULABLE, y `null` significa BORRAR la propiedad en HubSpot; `mobilePhone`
 * sigue la misma convención. Se modela como ausencia y no como cadena vacía a propósito: la
 * cadena vacía es la representación que HubSpot exige EN EL CABLE, y dejarla entrar en el
 * dominio obligaría a cada llamador a recordarla —y a alguno se le olvidaría, enviando `""`
 * donde quería un número o al revés. La traducción vive en UN solo sitio:
 * `buildHubSpotContactUpdateProperties`.
 */
export interface HubSpotContactUpdateInput {
  phone: string | null;
  mobilePhone: string | null;
}

/**
 * LA representación canónica del PATCH en el cable. Única y exportada para que las pruebas
 * afirmen el cuerpo EXACTO y para que el adaptador no pueda inventar una segunda.
 *
 * HubSpot borra una propiedad recibiéndola como CADENA VACÍA; omitirla del objeto `properties`
 * no la borra, la deja como estaba. Por eso `null` se traduce a `''` y nunca a una omisión: un
 * borrado que se representara omitiendo el campo sería un no-op silencioso, y el contacto
 * seguiría diciendo `synced` sobre un número que HubSpot conserva. `mobilephone` (minúscula,
 * el nombre de propiedad real de HubSpot) sigue la misma convención que `phone`.
 */
export function buildHubSpotContactUpdateProperties(
  input: HubSpotContactUpdateInput,
): { phone: string; mobilephone: string } {
  return { phone: input.phone ?? '', mobilephone: input.mobilePhone ?? '' };
}

export type CompanyAssociationStatus = 'associated' | 'failed';

// ── Completar vacíos al vincular un contacto que YA existía en HubSpot ──
// (AGENT2A-HUBSPOT-FILL-EMPTY-ON-APPROVAL)
//
// Hasta este corte, `linked_existing` sólo guardaba el id y asociaba la empresa: ningún dato de
// SellUp viajaba, así que un teléfono encontrado por SellUp nunca llegaba a un contacto que el
// cliente ya tenía en su CRM —y el portero del autosync lo daba por `synced` para siempre—.
//
// La regla es UNA y es conservadora: se escribe una propiedad SÓLO si en HubSpot está VACÍA y
// SellUp tiene un valor. Nunca se sobrescribe un dato que ya vive en el CRM del cliente (puede
// haberlo corregido a mano) y nunca se envía una cadena vacía (que en HubSpot BORRA).

/**
 * Propiedades de HubSpot que SellUp LEE del contacto existente y puede completar si están vacías.
 * Nombres REALES de HubSpot. `company_phone` y `telefono_alterno` se leen siempre, pero sólo se
 * escriben si su interruptor está encendido (`HUBSPOT_PHONE_SLOT_WRITE_ENABLED`).
 */
export const HUBSPOT_FILL_EMPTY_PROPERTY_NAMES = [
  'firstname',
  'lastname',
  'jobtitle',
  'phone',
  'mobilephone',
  'company_phone',
  'telefono_alterno',
  'hs_linkedin_url',
] as const;

export type HubSpotFillEmptyPropertyName = (typeof HUBSPOT_FILL_EMPTY_PROPERTY_NAMES)[number];

// ── Campos de teléfono de HubSpot, en orden de prioridad (AGENT2A-HUBSPOT-PHONE-SLOTS-ORDER) ──
//
// Un número que SellUp tiene y que el contacto de HubSpot NO tiene (en ninguno de estos campos)
// va al PRIMER campo vacío de esta lista. Un campo en uso se salta. Nunca se pisa ni se borra.
//
//   1. `phone`          («Phone Number»)
//   2. `mobilephone`    («Mobile Phone Number»)
//   3. `company_phone`  («Company phone»)  — APAGADO hasta que se apruebe su uso
//   4. `telefono_alterno` («Teléfono alterno») — encendido (12-11; reemplaza a `telefono_2`)

/** Orden de los campos de teléfono de HubSpot. Nombres REALES de HubSpot. */
export const HUBSPOT_PHONE_SLOT_ORDER = ['phone', 'mobilephone', 'company_phone', 'telefono_alterno'] as const;

export type HubSpotPhoneSlotName = (typeof HUBSPOT_PHONE_SLOT_ORDER)[number];

/**
 * Qué campos de teléfono se pueden ESCRIBIR hoy. Habilitar `company_phone` es cambiar aquí su
 * `false` por `true`: el orden, la lectura, la regla de duplicados y el reintento sin él si
 * HubSpot lo rechaza (400) ya están cableados. Apagado, SÍ se lee: un número que el CRM ya tiene
 * en él no se reenvía a otro campo.
 *
 * 12-11 (decisión de Bryan): `telefono_2` se borró del portal; en su lugar va `telefono_alterno`
 * («Teléfono alterno»), de tipo TELÉFONO, y queda ENCENDIDO. `company_phone` sigue apagado.
 */
export const HUBSPOT_PHONE_SLOT_WRITE_ENABLED: Readonly<Record<HubSpotPhoneSlotName, boolean>> = {
  phone: true,
  mobilephone: true,
  company_phone: false,
  telefono_alterno: true,
};

/**
 * Cómo viaja un número a cada campo. Los cuatro campos son de tipo teléfono/texto en el portal
 * de Ubits (`telefono_alterno` incluido, a diferencia del borrado `telefono_2`, que era NÚMERO):
 * el número viaja tal cual. Se conserva como punto único por si un campo futuro necesita formato.
 */
export function formatPhoneForHubSpotSlot(_name: HubSpotPhoneSlotName, value: string): string | null {
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function isHubSpotPhoneSlot(name: string): name is HubSpotPhoneSlotName {
  return (HUBSPOT_PHONE_SLOT_ORDER as readonly string[]).includes(name);
}

/**
 * ¿Se puede escribir esta propiedad en HubSpot? Todo lo que no es un campo de teléfono, sí; un
 * campo de teléfono, sólo si su interruptor está encendido.
 */
export function isHubSpotFillPropertyWritable(
  name: HubSpotFillEmptyPropertyName,
  writeEnabled: Readonly<Record<HubSpotPhoneSlotName, boolean>> = HUBSPOT_PHONE_SLOT_WRITE_ENABLED,
): boolean {
  return isHubSpotPhoneSlot(name) ? writeEnabled[name] === true : true;
}

/** Valores que HubSpot devolvió para el contacto existente (lo que la búsqueda pudo leer). */
export type HubSpotExistingContactProperties = Partial<
  Record<HubSpotFillEmptyPropertyName, string | null>
>;

/**
 * Resultado de buscar por email. `properties` es OPCIONAL a propósito: si no llegó (un
 * adaptador que no las pidió, una respuesta incompleta), no se sabe qué está vacío y NO se
 * completa nada — sin lectura no hay permiso para escribir.
 */
export interface HubSpotExistingContactMatch {
  id: string;
  properties?: HubSpotExistingContactProperties;
  /**
   * Correo del contacto en HubSpot, sólo cuando se leyó por id (AGENT2A-HUBSPOT-CANDIDATE-
   * IDENTITY-COMPLETION). `undefined` = no se leyó; `null`/'' = vacío en HubSpot.
   */
  email?: string | null;
}

/** Desenlace del completado del correo de un contacto ya vinculado. */
export interface HubSpotEmailFillReport {
  outcome: 'filled' | 'failed';
  /** Código mecánico (p. ej. `HUBSPOT_EMAIL_HTTP_409` si otro contacto ya usa ese correo). */
  error: string | null;
}

/** Cuerpo del PATCH de completado: sólo claves con valor no vacío. */
export type HubSpotContactFillProperties = Partial<Record<HubSpotFillEmptyPropertyName, string>>;

/** Qué pasó con el completado de vacíos en esta vinculación. */
export type HubSpotFillEmptyOutcome =
  /** Se escribieron una o más propiedades vacías. */
  | 'filled'
  /** HubSpot ya tenía todo lo que SellUp podía aportar. Cero escrituras. */
  | 'nothing_to_fill'
  /** No se pudieron leer las propiedades del contacto existente. Cero escrituras. */
  | 'existing_unreadable'
  /** El PATCH de completado falló. El vínculo sigue siendo válido. */
  | 'failed';

export interface HubSpotFillEmptyReport {
  outcome: HubSpotFillEmptyOutcome;
  /** Propiedades que HubSpot aceptó. Vacío salvo en `filled`. */
  properties: HubSpotFillEmptyPropertyName[];
  /** Código mecánico del fallo (sin payload: el cuerpo citaría el teléfono). */
  error: string | null;
}

/**
 * LA regla de completado, pura: qué propiedades viajarían para este contacto.
 *
 * Devuelve `null` cuando NO se pudo leer el contacto existente — distinto de `{}`, que significa
 * «leído y no falta nada». Confundirlos haría que una lectura fallida se viera como «completo».
 */
export function buildHubSpotFillEmptyProperties(
  contact: ContactForSync,
  existing: HubSpotExistingContactProperties | null | undefined,
  collectionPhones?: readonly RevealedPhoneForHubSpot[],
): HubSpotContactFillProperties | null {
  if (!existing || typeof existing !== 'object') return null;

  const { firstname, lastname } = splitContactName(contact);
  const local: Partial<Record<HubSpotFillEmptyPropertyName, string | null>> = {
    firstname,
    lastname,
    jobtitle: cleanString(contact.job_title),
    hs_linkedin_url: normalizeLinkedinUrlForHubSpot(contact.linkedin_url),
  };

  // AGENT2A-HUBSPOT-PHONE-SLOTS-ORDER: los teléfonos del contacto (principal primero) no van
  // campo a campo: siguen la MISMA regla que lo revelado (cada número que HubSpot no tiene va al
  // primer campo vacío de `HUBSPOT_PHONE_SLOT_ORDER`).
  //
  // AGENT2A-HUBSPOT-ALL-PHONES-CREATE-LINK (12-11): además de los escalares viaja la colección
  // oficial de teléfonos (el principal primero). La aprobación promueve TODOS los números a la
  // colección pero sólo proyecta el principal a `contacts.phone` (y nunca toca `mobile_phone`),
  // así que leyendo sólo los escalares un contacto con dos números llegaba a HubSpot con uno.
  const phones = collectContactPhonesForHubSpot(contact, collectionPhones);
  const phonePlan = planRevealedPhonesForHubSpot(phones, existing);

  // El orden de las claves sigue `HUBSPOT_FILL_EMPTY_PROPERTY_NAMES` (el rastro lo refleja).
  const fill: HubSpotContactFillProperties = {};
  for (const name of HUBSPOT_FILL_EMPTY_PROPERTY_NAMES) {
    if (isHubSpotPhoneSlot(name)) {
      const planned = phonePlan[name];
      if (planned) fill[name] = planned;
      continue;
    }
    const value = local[name];
    if (!value) continue;
    const remote = existing[name];
    const remoteIsEmpty = typeof remote !== 'string' || remote.trim().length === 0;
    if (remoteIsEmpty) fill[name] = value;
  }
  return fill;
}

// ── Teléfonos → campos de HubSpot (AGENT2A-REVEAL-PHONE-SLOTS + AGENT2A-HUBSPOT-PHONE-SLOTS-ORDER) ──
//
// Un número que SellUp tiene (revelado, unido o del propio contacto) viaja a HubSpot con UNA
// regla, la misma para el envío desde el candidato, la segunda fase del contacto oficial y el
// completado de vacíos al vincular:
//
//   1. Un número que HubSpot ya tiene —en CUALQUIERA de los campos de teléfono, encendido o no—
//      no viaja otra vez (se compara con `isSameHubSpotPhone`).
//   2. Cada número nuevo, en orden (el principal primero), va al PRIMER campo vacío de
//      `HUBSPOT_PHONE_SLOT_ORDER`: `phone` → `mobilephone` → `company_phone` → `telefono_alterno`.
//      Un campo en uso o apagado se salta.
//   3. Sin campo libre, el número no viaja: se queda en SellUp (su colección de teléfonos).
//   4. NUNCA se sobrescribe ni se borra lo que el CRM ya tiene.
//
// 11-11: el orden es ESTRICTO. Antes, con HubSpot sin números y dos revelados, el que el
// proveedor marcaba como celular iba a `mobilephone`; ahora el primero va a `phone`.
//
// Puro: sin red, sin DB, sin reloj.

/** Un número que puede viajar. `type` es el `phone_type` de la colección, si se conoce (informativo). */
export interface RevealedPhoneForHubSpot {
  phone: string;
  type?: string | null;
}

export type RevealedPhoneHubSpotPlan = Partial<Record<HubSpotPhoneSlotName, string>>;

function phoneDigitsForComparison(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\D+/g, '') : '';
}

/**
 * ¿Es el mismo número? Se comparan sólo los dígitos y se tolera que uno traiga el indicativo
 * del país y el otro no (`+57 300 111 2222` ≡ `3001112222`). Siete dígitos como mínimo para
 * que dos extensiones cortas no se confundan con un número completo.
 */
export function isSameHubSpotPhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = phoneDigitsForComparison(a);
  const db = phoneDigitsForComparison(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const [short, long] = da.length <= db.length ? [da, db] : [db, da];
  return short.length >= 7 && long.endsWith(short);
}

/**
 * Los números de un contacto, en orden de preferencia, para la regla de campos: primero la
 * colección oficial de teléfonos (ya ordenada con el principal primero y sin suprimidos ni
 * inválidos) y al final los escalares legacy (`phone`, `mobile_phone`), que cubren el contacto
 * sin filas en la colección. El planificador descarta los repetidos.
 */
export function collectContactPhonesForHubSpot(
  contact: Pick<ContactForSync, 'phone' | 'mobile_phone'>,
  collectionPhones?: readonly RevealedPhoneForHubSpot[] | null,
): RevealedPhoneForHubSpot[] {
  const phones: RevealedPhoneForHubSpot[] = [];
  for (const entry of collectionPhones ?? []) {
    const value = cleanString(entry?.phone ?? null);
    if (value) phones.push({ phone: value, type: entry?.type ?? null });
  }
  for (const scalar of [contact.phone, contact.mobile_phone]) {
    const value = cleanString(scalar);
    if (value) phones.push({ phone: value });
  }
  return phones;
}

/** Un contacto que se va a CREAR: todos sus campos de teléfono están vacíos (y se «leyeron»). */
export const NEW_HUBSPOT_CONTACT_PHONE_SLOTS: Readonly<HubSpotExistingContactProperties> = Object.freeze({
  phone: null,
  mobilephone: null,
  company_phone: null,
  telefono_alterno: null,
});

/**
 * ¿Está libre este campo? `phone` / `mobilephone` ausentes cuentan como vacíos (contrato de
 * siempre). Los campos adicionales sólo cuentan si se LEYERON (`null` o cadena vacía): sin
 * lectura no hay permiso para escribir.
 */
function isHubSpotPhoneSlotFree(name: HubSpotPhoneSlotName, existing: HubSpotExistingContactProperties): boolean {
  const value = existing[name];
  if (typeof value === 'string') return value.trim().length === 0;
  if (name === 'phone' || name === 'mobilephone') return true;
  return value === null;
}

/**
 * Qué números viajan y a qué campo. `revealed` va en orden de preferencia (el principal
 * primero). Devuelve sólo los campos VACÍOS (y encendidos) en HubSpot que se van a llenar.
 */
export function planRevealedPhonesForHubSpot(
  revealed: readonly RevealedPhoneForHubSpot[],
  existing: HubSpotExistingContactProperties,
  writeEnabled: Readonly<Record<HubSpotPhoneSlotName, boolean>> = HUBSPOT_PHONE_SLOT_WRITE_ENABLED,
): RevealedPhoneHubSpotPlan {
  const remoteNumbers: string[] = [];
  for (const name of HUBSPOT_PHONE_SLOT_ORDER) {
    const value = cleanString(existing[name] ?? null);
    if (value) remoteNumbers.push(value);
  }

  const pending: string[] = [];
  for (const entry of revealed) {
    const value = cleanString(entry?.phone ?? null);
    if (!value) continue;
    // Regla 1: lo que HubSpot ya tiene, en cualquier campo de teléfono, no viaja.
    if (remoteNumbers.some((remote) => isSameHubSpotPhone(value, remote))) continue;
    if (pending.some((p) => isSameHubSpotPhone(p, value))) continue;
    pending.push(value);
  }

  // Regla 2: cada número nuevo al primer campo vacío y encendido, en orden.
  const plan: RevealedPhoneHubSpotPlan = {};
  for (const name of HUBSPOT_PHONE_SLOT_ORDER) {
    if (pending.length === 0) break;
    if (writeEnabled[name] !== true) continue;
    if (!isHubSpotPhoneSlotFree(name, existing)) continue;
    const formatted = formatPhoneForHubSpotSlot(name, pending[0]);
    if (!formatted) continue;
    pending.shift();
    plan[name] = formatted;
  }
  return plan;
}

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
  linkedExistingFilled:
    'Contacto existente en HubSpot vinculado a SellUp; se completaron sus datos vacíos.',
  alreadySynced: 'Este contacto ya estaba sincronizado con HubSpot.',
  updated: 'Teléfono actualizado en HubSpot.',
  // CUT-3A: borrar tiene su propio mensaje. «Actualizado» sobre un borrado le diría a la
  // persona que envió un número cuando lo que hizo fue quitarlo.
  cleared: 'Teléfono eliminado en HubSpot.',
  hubspotUpdateError: 'No fue posible actualizar el contacto en HubSpot.',
  // AGENT2A-REVEAL-PHONE-SLOTS — un reveal nunca pisa: si HubSpot ya tenía los números, se dice.
  revealPhonesFilled: 'Teléfono revelado enviado a HubSpot (sólo campos vacíos).',
  revealPhonesAlreadyPresent:
    'HubSpot ya tenía esos números o no hay campos vacíos; no se sobrescribió nada.',
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
 * Normaliza la URL de LinkedIn que viaja a HubSpot: recorta espacios y añade `https://`
 * cuando llega sin protocolo (`linkedin.com/in/…`, `www.linkedin.com/in/…`). No toca el
 * percent-encoding. Devuelve `null` si no hay valor — nunca cadena vacía (en HubSpot BORRA).
 */
export function normalizeLinkedinUrlForHubSpot(value: string | null | undefined): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  if (/^([a-z]{2,3}\.|www\.)?linkedin\.com\//i.test(cleaned)) return `https://${cleaned}`;
  return cleaned;
}

/**
 * Construye las propiedades estándar y seguras para crear un contacto en HubSpot.
 * Incluye el LinkedIn (`hs_linkedin_url`) cuando el contacto lo tiene
 * (AGENT2A-HUBSPOT-LINKEDIN-ON-CREATE).
 */
export function buildHubSpotContactProperties(
  contact: ContactForSync,
  email: string,
  collectionPhones?: readonly RevealedPhoneForHubSpot[],
): HubSpotContactCreateInput {
  const { firstname, lastname } = splitContactName(contact);
  // AGENT2A Task A3: los DOS escalares viajan cada uno a SU campo (`phone` → `phone`,
  // `mobile_phone` → `mobilephone`), simétrico con el PATCH de una edición (CUT-2/A4), que también
  // es campo a campo: si el alta los reordenara, una edición posterior BORRARÍA en HubSpot lo que
  // el alta puso en el campo «equivocado».
  //
  // AGENT2A-HUBSPOT-ALL-PHONES-CREATE-LINK (12-11): el resto de la colección oficial de teléfonos
  // (el principal primero) llena los campos que quedan libres con LA regla de campos
  // (`planRevealedPhonesForHubSpot`): `mobilephone` si está vacío → (`company_phone`, apagado) →
  // `telefono_alterno`. Un número igual a un escalar no se repite. Antes la colección no viajaba
  // y, como la aprobación nunca llena `mobile_phone`, un contacto con dos números llegaba con uno.
  const phone = cleanString(contact.phone);
  const mobilePhone = cleanString(contact.mobile_phone);
  const plan = planRevealedPhonesForHubSpot(
    collectContactPhonesForHubSpot({ phone: null, mobile_phone: null }, collectionPhones),
    { ...NEW_HUBSPOT_CONTACT_PHONE_SLOTS, phone, mobilephone: mobilePhone },
  );
  const input: HubSpotContactCreateInput = {
    email,
    firstname,
    lastname,
    jobtitle: cleanString(contact.job_title),
    phone: phone ?? plan.phone ?? null,
    mobilePhone: mobilePhone ?? plan.mobilephone ?? null,
    linkedinUrl: normalizeLinkedinUrlForHubSpot(contact.linkedin_url),
  };
  // Los adicionales sólo aparecen con valor: el contrato del alta sin ellos no cambia.
  if (plan.company_phone) input.companyPhone = plan.company_phone;
  if (plan.telefono_alterno) input.alternatePhone = plan.telefono_alterno;
  return input;
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
  /** Sólo en `linked_existing`: qué datos vacíos de HubSpot se completaron. */
  fillEmpty?: HubSpotFillEmptyReport | null;
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
    fillEmpty,
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
      ...(fillEmpty ? { fill_empty: fillEmpty } : {}),
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
  findHubSpotContactByEmail: (email: string) => Promise<HubSpotExistingContactMatch | null>;
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
  /**
   * AGENT2A-HUBSPOT-FILL-EMPTY-ON-APPROVAL — PATCH que SÓLO completa propiedades vacías de un
   * contacto que ya existía en HubSpot. Dependencia separada de `updateHubSpotContact` a
   * propósito: aquél escribe el teléfono local tal cual (y puede BORRAR); éste nunca recibe
   * una propiedad que HubSpot ya tenga, ni una cadena vacía. Devuelve lo que HubSpot aceptó.
   *
   * Opcional: sin ella, la vinculación se comporta exactamente como antes (sólo id + empresa).
   */
  fillEmptyHubSpotContactProperties?: (
    hubspotContactId: string,
    properties: HubSpotContactFillProperties,
  ) => Promise<{ ok: true; written: HubSpotFillEmptyPropertyName[] } | { error: string }>;
  /**
   * AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION — lectura por id de un contacto que llegó
   * YA vinculado (los de «Primero HubSpot» se vinculan al aprobar, antes del sync). Con ella y
   * con `fillEmptyHubSpotContactProperties`, la reparación (rama D) completa los vacíos UNA vez
   * —lo que SellUp reveló: teléfono, LinkedIn— igual que `linked_existing`. Nunca sobrescribe.
   *
   * Opcional: sin ella la rama D se comporta exactamente como antes (sin red).
   */
  findHubSpotContactById?: (hubspotContactId: string) => Promise<HubSpotExistingContactMatch | null>;
  /**
   * AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION — PATCH SÓLO del correo, para un contacto ya
   * vinculado cuyo correo está VACÍO en HubSpot (p. ej. llegó sólo con LinkedIn y SellUp reveló el
   * correo). Va aparte del resto a propósito: HubSpot rechaza un correo que ya usa otro contacto
   * (409) y ese rechazo no puede impedir que el teléfono y el LinkedIn lleguen.
   */
  fillEmptyHubSpotContactEmail?: (
    hubspotContactId: string,
    email: string,
  ) => Promise<{ ok: true } | { error: string }>;
  /**
   * AGENT2A-REVEAL-PHONE-SLOTS — los números VIVOS del contacto (el principal primero) para un
   * pendiente que dejó un REVEAL. Opcional: sin ella (o si falla) viajan los escalares.
   * AGENT2A-HUBSPOT-ALL-PHONES-CREATE-LINK: también la usan la CREACIÓN y el completado de
   * vacíos al VINCULAR, para que viajen todos los números y no sólo `contacts.phone`.
   */
  loadRevealedPhones?: (contactId: string) => Promise<RevealedPhoneForHubSpot[]>;
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
  // AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION — un contacto que llegó YA vinculado desde
  // «Primero HubSpot» puede no tener correo (sólo LinkedIn). Su identidad en HubSpot es el id
  // durable, no el correo, así que su PRIMER sync (la reparación de la rama D, que sólo completa
  // vacíos) no necesita correo. Todo lo demás sigue exigiéndolo exactamente como antes.
  const linkedFirstSyncWithoutEmail =
    !email &&
    !!cleanString(contact.hubspot_contact_id) &&
    readHubSpotSyncState(contact.metadata)?.status !== 'synced' &&
    !hasPendingHubSpotPhoneChange(readHubSpotSyncState(contact.metadata));
  if (!email && !linkedFirstSyncWithoutEmail) {
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

      // ── B' — El pendiente lo dejó un REVEAL (AGENT2A-REVEAL-PHONE-SLOTS) ─────────
      // Un número que encontró un proveedor no es una edición de una persona: no tiene autoridad
      // para PISAR ni BORRAR lo que el CRM del cliente ya tiene. Se completan SÓLO campos vacíos
      // con la regla de `planRevealedPhonesForHubSpot` (cada número nuevo al primer campo vacío:
      // `phone` → `mobilephone` → `company_phone` → `telefono_alterno`; `company_phone` apagado) y el pendiente se
      // cierra: de este reveal ya no queda nada sin enviar, y lo que HubSpot tenía se respeta.
      //
      // 11-11 (feedback líder): una UNIÓN (`merge`) tampoco es una edición de una persona —
      // trae el número que encontró un proveedor— y antes viajaba por el PATCH completo,
      // pisando el `phone` de HubSpot. Ahora sigue la misma regla de sólo-campos-vacíos.
      if (priorState?.stale_source === 'reveal' || priorState?.stale_source === 'merge') {
        const failReveal = async (): Promise<SyncContactToHubSpotResult> => {
          await recordBlockedOrFailed('failed', HUBSPOT_SYNC_ERROR_CODES.hubspotUpdateFailed);
          return { ok: false, errorCode: 'HUBSPOT_ERROR', message: SYNC_MESSAGES.hubspotUpdateError };
        };
        // Sin poder LEER el contacto no se sabe qué está vacío: no se escribe nada.
        if (!deps.findHubSpotContactById || !deps.fillEmptyHubSpotContactProperties) return failReveal();
        let remote: HubSpotExistingContactMatch | null = null;
        try {
          remote = await deps.findHubSpotContactById(hubspotContactId);
        } catch {
          remote = null;
        }
        if (!remote?.properties) return failReveal();

        let revealed: RevealedPhoneForHubSpot[] = [];
        if (deps.loadRevealedPhones) {
          try {
            revealed = await deps.loadRevealedPhones(contact.id);
          } catch {
            revealed = [];
          }
        }
        // Los escalares al final: el principal ya viene en la colección; esto cubre la forma
        // legacy (contacto sin filas en la colección). El planificador descarta duplicados.
        for (const scalar of [contact.phone, contact.mobile_phone]) {
          const value = cleanString(scalar);
          if (value) revealed.push({ phone: value });
        }
        const plan = planRevealedPhonesForHubSpot(revealed, remote.properties);
        const wrote = Object.keys(plan).length > 0;
        if (wrote) {
          let filled: { ok: true; written: HubSpotFillEmptyPropertyName[] } | { error: string };
          try {
            filled = await deps.fillEmptyHubSpotContactProperties(hubspotContactId, plan);
          } catch {
            filled = { error: 'HUBSPOT_FILL_ERROR' };
          }
          if ('error' in filled) return failReveal();
        }

        const persistReveal = await deps.persistSync(contact.id, {
          hubspot_contact_id: null,
          metadata: buildUpdatedSyncMetadata({
            existing: contact.metadata,
            hubspotContactId,
            actorId: deps.actorId,
            nowIso: deps.nowIso,
            method: deps.method,
          }),
        });
        if (persistReveal.error) {
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
          message: wrote ? SYNC_MESSAGES.revealPhonesFilled : SYNC_MESSAGES.revealPhonesAlreadyPresent,
        };
      }

      // Los teléfonos se releen de la FILA, no del marcador: entre marcar y pulsar pudieron
      // cambiar otra vez —o desaparecer—, y lo que debe viajar es lo que hay AHORA. La razón
      // guardada no decide el cuerpo: si mandara, un `phone_changed` obsoleto enviaría un
      // número que ya no existe y un `phone_removed` obsoleto BORRARÍA en HubSpot uno que sí
      // existe.
      //
      // CUT-3A: `null` ya no es un motivo para negarse. Es la operación de BORRADO, y el
      // adaptador tiene UNA representación canónica para ella.
      //
      // AGENT2A Task A4: los DOS teléfonos viajan de forma independiente, cada uno leído
      // directamente de su propio campo — simétrico con el alta (Task A3). Antes esta rama
      // seguía usando `resolveOutboundHubSpotPhone` (el valor colapsado con prioridad al
      // móvil) sólo para `phone`, lo que para un contacto con ambos campos poblados sobreescribía
      // la propiedad `phone` de HubSpot con el número de CELULAR en cada actualización, mientras
      // `mobilephone` también —correctamente— guardaba ese mismo número: una duplicación real y
      // una asimetría con el alta, que ya lee los dos campos por separado.
      const outboundPhone = cleanString(contact.phone);
      const outboundMobilePhone = cleanString(contact.mobile_phone);

      const updateResult = await deps.updateHubSpotContact(hubspotContactId, {
        phone: outboundPhone,
        mobilePhone: outboundMobilePhone,
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
      // Completar vacíos (AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION). No es un PATCH del
      // teléfono local: sólo viaja lo que HubSpot tiene VACÍO, así que no puede pisar «un dato que
      // quizá es mejor». Best-effort: pase lo que pase aquí, la reparación sigue.
      const { fillEmpty, emailFill } = await fillEmptyOnLinkedContact(contact, hubspotContactId, deps);
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
          }, fillEmpty || emailFill
            ? { ...(fillEmpty ? { fill_empty: fillEmpty } : {}), ...(emailFill ? { email_fill: emailFill } : {}) }
            : undefined),
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

  // Inalcanzable: sin correo sólo se llega aquí por la rama D, que ya devolvió.
  if (!email) {
    await recordBlockedOrFailed('blocked_no_email', null);
    return { ok: false, errorCode: 'MISSING_EMAIL', message: SYNC_MESSAGES.missingEmail };
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
  let existing: HubSpotExistingContactMatch | null;
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
      buildHubSpotContactProperties(contact, email, await loadContactPhonesSafely(contact, deps)),
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

  // Completar vacíos (sólo si el contacto YA existía). Best-effort: el vínculo es válido pase lo
  // que pase aquí, igual que con la asociación de empresa.
  let fillEmpty: HubSpotFillEmptyReport | null = null;
  if (mode === 'linked_existing' && existing) {
    fillEmpty = await fillEmptyOnExistingContact(contact, existing, deps);
  }

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
    fillEmpty,
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
    message:
      mode === 'created'
        ? SYNC_MESSAGES.created
        : fillEmpty?.outcome === 'filled'
          ? SYNC_MESSAGES.linkedExistingFilled
          : SYNC_MESSAGES.linkedExisting,
  };
}

/**
 * Completado de vacíos para un contacto que llegó YA vinculado (rama D). NUNCA lanza.
 *
 * Sin las dos dependencias devuelve `null` (comportamiento anterior: cero red). Si no se pudo
 * comprobar la conexión o leer el contacto, no se escribe nada: no saber qué está vacío no
 * autoriza a escribir.
 */
async function fillEmptyOnLinkedContact(
  contact: ContactForSync,
  hubspotContactId: string,
  deps: SyncContactDeps,
): Promise<{ fillEmpty: HubSpotFillEmptyReport | null; emailFill: HubSpotEmailFillReport | null }> {
  const none = { fillEmpty: null, emailFill: null };
  if (!deps.findHubSpotContactById || !deps.fillEmptyHubSpotContactProperties) return none;
  let existing: HubSpotExistingContactMatch | null;
  try {
    const connection = await deps.checkConnection();
    if (!connection.connected || !connection.canWriteContacts) return none;
    existing = await deps.findHubSpotContactById(hubspotContactId);
  } catch (err) {
    return {
      fillEmpty: {
        outcome: 'existing_unreadable',
        properties: [],
        error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_READ_ERROR',
      },
      emailFill: null,
    };
  }
  if (!existing) return { fillEmpty: { outcome: 'existing_unreadable', properties: [], error: null }, emailFill: null };

  const fillEmpty = await fillEmptyOnExistingContact(contact, existing, deps);

  // El correo, sólo si se LEYÓ y está vacío en HubSpot. `undefined` = no se leyó ⇒ no se escribe.
  let emailFill: HubSpotEmailFillReport | null = null;
  const localEmail = sanitizeEmail(contact.email);
  const remoteEmail = existing.email;
  if (
    deps.fillEmptyHubSpotContactEmail &&
    localEmail &&
    remoteEmail !== undefined &&
    !cleanString(remoteEmail)
  ) {
    try {
      const written = await deps.fillEmptyHubSpotContactEmail(existing.id, localEmail);
      emailFill = 'error' in written ? { outcome: 'failed', error: written.error } : { outcome: 'filled', error: null };
    } catch (err) {
      emailFill = { outcome: 'failed', error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_EMAIL_FILL_ERROR' };
    }
  }
  return { fillEmpty, emailFill };
}

/**
 * La colección de teléfonos del contacto (AGENT2A-HUBSPOT-ALL-PHONES-CREATE-LINK). NUNCA lanza:
 * sin lector cableado o si la lectura falla, `[]` y se sigue con los escalares (comportamiento
 * anterior a este corte) — no poder leer la colección no debe impedir crear ni vincular.
 */
async function loadContactPhonesSafely(
  contact: ContactForSync,
  deps: SyncContactDeps,
): Promise<RevealedPhoneForHubSpot[]> {
  if (!deps.loadRevealedPhones) return [];
  try {
    return await deps.loadRevealedPhones(contact.id);
  } catch {
    return [];
  }
}

/**
 * Ejecuta el completado de vacíos sobre un contacto existente. NUNCA lanza.
 *
 * Sin escritor cableado devuelve `null`: no se escribe nada ni se anota nada (comportamiento
 * anterior a este corte).
 */
async function fillEmptyOnExistingContact(
  contact: ContactForSync,
  existing: HubSpotExistingContactMatch,
  deps: SyncContactDeps,
): Promise<HubSpotFillEmptyReport | null> {
  if (!deps.fillEmptyHubSpotContactProperties) return null;

  const fill = buildHubSpotFillEmptyProperties(
    contact,
    existing.properties,
    await loadContactPhonesSafely(contact, deps),
  );
  if (fill === null) return { outcome: 'existing_unreadable', properties: [], error: null };
  if (Object.keys(fill).length === 0) {
    return { outcome: 'nothing_to_fill', properties: [], error: null };
  }

  try {
    const result = await deps.fillEmptyHubSpotContactProperties(existing.id, fill);
    if ('error' in result) return { outcome: 'failed', properties: [], error: result.error };
    return result.written.length > 0
      ? { outcome: 'filled', properties: result.written, error: null }
      : { outcome: 'nothing_to_fill', properties: [], error: null };
  } catch (err) {
    return {
      outcome: 'failed',
      properties: [],
      error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_FILL_ERROR',
    };
  }
}

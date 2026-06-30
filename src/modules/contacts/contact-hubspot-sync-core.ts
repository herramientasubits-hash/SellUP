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

export type CompanyAssociationStatus = 'associated' | 'failed';

/** Patch que se persiste localmente tras una sincronización exitosa. */
export interface ContactHubSpotSyncPatch {
  hubspot_contact_id: string;
  metadata: Record<string, unknown>;
}

// ── Resultado ───────────────────────────────────────────────────

export type SyncContactToHubSpotResult =
  | {
      ok: true;
      status: 'created' | 'linked_existing' | 'already_synced';
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
    phone: cleanString(contact.mobile_phone) ?? cleanString(contact.phone),
  };
}

/** Construye la metadata de trazabilidad `hubspot_sync` preservando el resto. */
export function buildSyncMetadata(args: {
  existing: Record<string, unknown> | null | undefined;
  hubspotContactId: string;
  mode: 'created' | 'linked_existing';
  hubspotCompanyId: string;
  companyAssociation: CompanyAssociationStatus;
  actorId: string;
  nowIso: string;
}): Record<string, unknown> {
  const {
    existing,
    hubspotContactId,
    mode,
    hubspotCompanyId,
    companyAssociation,
    actorId,
    nowIso,
  } = args;
  return {
    ...(existing ?? {}),
    hubspot_sync: {
      status: 'synced',
      synced_at: nowIso,
      synced_by: actorId,
      hubspot_contact_id: hubspotContactId,
      mode,
      hubspot_company_id: hubspotCompanyId,
      company_association: companyAssociation,
    },
  };
}

// ── Dependencias inyectables ────────────────────────────────────

export interface SyncAuditEntry {
  contactId: string;
  accountId: string;
  actorUserId: string | null;
  hubspotContactId: string;
  hubspotCompanyId: string;
  mode: 'created' | 'linked_existing';
  companyAssociation: CompanyAssociationStatus;
}

export interface SyncContactDeps {
  actorId: string;
  nowIso: string;
  loadContact: (id: string) => Promise<ContactForSync | null>;
  loadAccount: (accountId: string) => Promise<AccountForSync | null>;
  checkConnection: () => Promise<HubSpotSyncConnection>;
  findHubSpotContactByEmail: (email: string) => Promise<{ id: string } | null>;
  createHubSpotContact: (
    input: HubSpotContactCreateInput,
  ) => Promise<{ id: string } | { error: string }>;
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
 *  3. Si ya tiene hubspot_contact_id → already_synced (idempotente, sin escritura).
 *  4. Busca por email: si existe → vincula; si no → crea (sin duplicar).
 *  5. Asocia el contacto a la empresa HubSpot (best-effort, no fatal).
 *  6. Persiste hubspot_contact_id + metadata.hubspot_sync localmente.
 *
 * NO crea empresas/deals/notas. NO llama a Apollo. NO toca candidatos.
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

  const email = sanitizeEmail(contact.email);
  if (!email) {
    return { ok: false, errorCode: 'MISSING_EMAIL', message: SYNC_MESSAGES.missingEmail };
  }

  if (!contact.account_id) {
    return { ok: false, errorCode: 'MISSING_ACCOUNT', message: SYNC_MESSAGES.missingAccount };
  }

  // Idempotencia: si ya está vinculado, no duplicamos ni reescribimos. Se evalúa
  // antes de tocar cuenta/conexión para que sea independiente del estado HubSpot.
  if (cleanString(contact.hubspot_contact_id)) {
    return {
      ok: true,
      status: 'already_synced',
      hubspotContactId: contact.hubspot_contact_id as string,
      message: SYNC_MESSAGES.alreadySynced,
    };
  }

  const account = await deps.loadAccount(contact.account_id);
  const hubspotCompanyId = cleanString(account?.hubspot_company_id);
  if (!hubspotCompanyId) {
    return {
      ok: false,
      errorCode: 'MISSING_HUBSPOT_COMPANY',
      message: SYNC_MESSAGES.missingCompany,
    };
  }

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

  const existing = await deps.findHubSpotContactByEmail(email);
  if (existing) {
    hubspotContactId = existing.id;
    mode = 'linked_existing';
  } else {
    const createResult = await deps.createHubSpotContact(
      buildHubSpotContactProperties(contact, email),
    );
    if ('error' in createResult) {
      // Falló la creación en HubSpot → no marcamos como sincronizado.
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
  });
  const persistResult = await deps.persistSync(contact.id, { hubspot_contact_id: hubspotContactId, metadata });
  if (persistResult.error) {
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

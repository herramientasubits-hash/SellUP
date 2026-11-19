// Agente 2A — Correo principal / adicional y empresa principal del contacto en HubSpot
// (AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE, Bryan 18-11).
//
// Núcleo PURO: la red entra por `deps` (adaptadores de `hubspot-contact-sync.ts`). NUNCA lanza.
//
// Reglas:
//   * Correo nuevo de la misma empresa (o de la empresa nueva tras un cambio) → pasa a ser el
//     PRINCIPAL y el anterior se conserva como correo ADICIONAL. HubSpot no expone en la API v3 una
//     operación «promover»: se cambia el principal (`PATCH email`) y, si el anterior no quedó entre
//     los adicionales, se agrega con la API v1 de correos secundarios. Se relee para comprobarlo.
//   * Correo personal → sólo ADICIONAL, nunca principal.
//   * 409 al cambiar el principal = otro contacto de HubSpot ya usa ese correo: no se cambia nada
//     (fusionar duplicados es un proceso aparte, por definir).
//   * Sin poder LEER el contacto no se escribe nada.
//   * Al aprobar un cambio de empresa: la empresa nueva queda como «Principal» y el contacto se
//     desasocia de las demás. Primero se asocia la nueva (el contacto nunca queda sin empresa).

export interface HubSpotContactEmails {
  primary: string | null;
  additional: string[];
}

export interface HubSpotEmailDeps {
  readEmails: (hubspotContactId: string) => Promise<HubSpotContactEmails | null>;
  setPrimaryEmail: (hubspotContactId: string, email: string) => Promise<{ ok: true } | { error: string; status?: number }>;
  addSecondaryEmail: (hubspotContactId: string, email: string) => Promise<{ ok: true } | { error: string }>;
}

export type HubSpotPrimaryEmailOutcome =
  /** El nuevo es el principal y el anterior quedó como adicional (o no había anterior). */
  | 'promoted'
  /** El nuevo es el principal, pero HubSpot no aceptó guardar el anterior como adicional. */
  | 'promoted_previous_not_kept'
  /** Ya era el principal. */
  | 'already_primary'
  /** Otro contacto de HubSpot usa ese correo: no se cambió nada. */
  | 'conflict'
  /** No se pudo leer el contacto: no se escribió nada. */
  | 'unreadable'
  | 'failed';

export type HubSpotAdditionalEmailOutcome =
  | 'added_as_additional'
  | 'already_additional'
  | 'already_primary'
  | 'conflict'
  | 'unreadable'
  | 'failed';

function norm(value: string | null | undefined): string | null {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return v || null;
}

async function safe<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await call();
  } catch {
    return fallback;
  }
}

export async function makeHubSpotPrimaryEmail(
  hubspotContactId: string,
  newEmail: string,
  deps: HubSpotEmailDeps,
): Promise<HubSpotPrimaryEmailOutcome> {
  const target = norm(newEmail);
  if (!target) return 'failed';
  const before = await safe(() => deps.readEmails(hubspotContactId), null);
  if (!before) return 'unreadable';
  const previous = norm(before.primary);
  if (previous === target) return 'already_primary';

  const set = await safe(() => deps.setPrimaryEmail(hubspotContactId, target), { error: 'THREW' } as { error: string; status?: number });
  if (!('ok' in set)) return set.status === 409 ? 'conflict' : 'failed';
  if (!previous) return 'promoted';

  const after = await safe(() => deps.readEmails(hubspotContactId), null);
  if (after && after.additional.map(norm).includes(previous)) return 'promoted';
  const kept = await safe(() => deps.addSecondaryEmail(hubspotContactId, previous), { error: 'THREW' } as { error: string });
  return 'ok' in kept ? 'promoted' : 'promoted_previous_not_kept';
}

export async function addHubSpotAdditionalEmail(
  hubspotContactId: string,
  email: string,
  deps: HubSpotEmailDeps,
): Promise<HubSpotAdditionalEmailOutcome> {
  const target = norm(email);
  if (!target) return 'failed';
  const before = await safe(() => deps.readEmails(hubspotContactId), null);
  if (!before) return 'unreadable';
  if (norm(before.primary) === target) return 'already_primary';
  if (before.additional.map(norm).includes(target)) return 'already_additional';
  const added = await safe(() => deps.addSecondaryEmail(hubspotContactId, target), { error: 'THREW' } as { error: string });
  if ('ok' in added) return 'added_as_additional';
  return /_409$/.test(added.error) ? 'conflict' : 'failed';
}

// ── Empresa principal ───────────────────────────────────────────────

export interface HubSpotCompanyAssociationDeps {
  listCompanyIds: (hubspotContactId: string) => Promise<string[] | null>;
  setPrimaryCompany: (hubspotContactId: string, hubspotCompanyId: string) => Promise<{ ok: true } | { error: string }>;
  removeCompany: (hubspotContactId: string, hubspotCompanyId: string) => Promise<{ ok: true } | { error: string }>;
}

export type HubSpotCompanyMoveOutcome =
  /** La nueva es la principal y no quedó ninguna otra. */
  | 'moved'
  /** La nueva es la principal, pero no se pudo quitar alguna de las otras (o no se pudo leer la lista). */
  | 'partial'
  | 'failed';

export interface HubSpotCompanyMoveReport {
  outcome: HubSpotCompanyMoveOutcome;
  removed: string[];
  notRemoved: string[];
}

/** Qué asociaciones quitar: todas menos la empresa destino. */
export function planHubSpotCompanyReassociation(currentCompanyIds: readonly string[], targetCompanyId: string): string[] {
  const target = targetCompanyId.trim();
  return [...new Set(currentCompanyIds.map((id) => id.trim()).filter((id) => id && id !== target))];
}

export async function moveHubSpotContactToCompany(
  hubspotContactId: string,
  hubspotCompanyId: string,
  deps: HubSpotCompanyAssociationDeps,
): Promise<HubSpotCompanyMoveReport> {
  const primary = await safe(() => deps.setPrimaryCompany(hubspotContactId, hubspotCompanyId), { error: 'THREW' } as { error: string });
  if (!('ok' in primary)) return { outcome: 'failed', removed: [], notRemoved: [] };
  const current = await safe(() => deps.listCompanyIds(hubspotContactId), null);
  if (!current) return { outcome: 'partial', removed: [], notRemoved: [] };
  const removed: string[] = [];
  const notRemoved: string[] = [];
  for (const companyId of planHubSpotCompanyReassociation(current, hubspotCompanyId)) {
    const result = await safe(() => deps.removeCompany(hubspotContactId, companyId), { error: 'THREW' } as { error: string });
    if ('ok' in result) removed.push(companyId);
    else notRemoved.push(companyId);
  }
  return { outcome: notRemoved.length === 0 ? 'moved' : 'partial', removed, notRemoved };
}

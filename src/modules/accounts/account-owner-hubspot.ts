// ACCOUNT-OWNER-HUBSPOT-NOTICE-1 — de dónde salió el responsable de una empresa y si coincide
// con el dueño que tiene en HubSpot. Puro: sin red ni base.
//
// Por qué (22-10): en 90 de 103 empresas enlazadas a HubSpot el responsable de SellUp no era el
// dueño de HubSpot. Los vendedores entraron a SellUp el 20-10; las empresas traídas antes
// quedaron a nombre de quien buscó y ese responsable ya no se corrige solo. Aquí no se cambia a
// nadie: se guarda lo que dice HubSpot y la ficha lo avisa.

/** Lo que dice HubSpot del dueño de la empresa, guardado en `accounts.metadata.hubspot_owner`. */
export interface HubSpotOwnerSnapshot {
  hubspot_owner_id: string | null;
  email: string | null;
  /** Usuario activo de SellUp con ese correo; null si no tiene usuario o no está activo. */
  sellup_user_id: string | null;
  read_at: string;
}

/** De dónde salió el responsable, guardado en `accounts.metadata.owner_origin`. */
export interface AccountOwnerOrigin {
  source: 'hubspot_owner' | 'searcher';
  decided_at: string;
}

export function buildHubSpotOwnerSnapshot(input: {
  hubspotOwnerId: string | null;
  hubspotOwnerEmail: string | null;
  hubspotOwnerUserId: string | null;
  nowIso: string;
}): HubSpotOwnerSnapshot {
  return {
    hubspot_owner_id: input.hubspotOwnerId,
    email: input.hubspotOwnerEmail,
    sellup_user_id: input.hubspotOwnerUserId,
    read_at: input.nowIso,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readHubSpotOwnerSnapshot(metadata: unknown): HubSpotOwnerSnapshot | null {
  if (!isRecord(metadata) || !isRecord(metadata.hubspot_owner)) return null;
  const raw = metadata.hubspot_owner;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const readAt = text(raw.read_at);
  if (!readAt) return null;
  return {
    hubspot_owner_id: text(raw.hubspot_owner_id),
    email: text(raw.email)?.toLowerCase() ?? null,
    sellup_user_id: text(raw.sellup_user_id),
    read_at: readAt,
  };
}

export type OwnerVsHubSpotNotice =
  /** El dueño de HubSpot es otro usuario de SellUp. */
  | { kind: 'other_sellup_user'; hubspotOwnerEmail: string; readAt: string }
  /** El dueño de HubSpot no tiene usuario activo en SellUp (buzón genérico, ya no está…). */
  | { kind: 'not_in_sellup'; hubspotOwnerEmail: string; readAt: string };

/**
 * ¿Hay que avisar en la ficha? Sólo cuando HubSpot tiene un dueño con correo y no es el
 * responsable actual. Sin lectura de HubSpot guardada, no se avisa (no se adivina).
 */
export function describeOwnerVsHubSpot(input: {
  ownerId: string | null;
  metadata: unknown;
}): OwnerVsHubSpotNotice | null {
  const snapshot = readHubSpotOwnerSnapshot(input.metadata);
  if (!snapshot?.email) return null;
  if (snapshot.sellup_user_id && snapshot.sellup_user_id === input.ownerId) return null;
  return snapshot.sellup_user_id
    ? { kind: 'other_sellup_user', hubspotOwnerEmail: snapshot.email, readAt: snapshot.read_at }
    : { kind: 'not_in_sellup', hubspotOwnerEmail: snapshot.email, readAt: snapshot.read_at };
}

/** Texto del aviso, corto y con el siguiente paso. */
export function ownerVsHubSpotCopy(notice: OwnerVsHubSpotNotice): { title: string; description: string } {
  if (notice.kind === 'other_sellup_user') {
    return {
      title: `En HubSpot esta empresa es de ${notice.hubspotOwnerEmail}`,
      description: 'El responsable en SellUp es otra persona. Si corresponde, cámbialo desde «Acciones».',
    };
  }
  return {
    title: `En HubSpot esta empresa es de ${notice.hubspotOwnerEmail}`,
    description: 'Ese dueño no tiene usuario activo en SellUp. Revisa quién debe llevarla.',
  };
}

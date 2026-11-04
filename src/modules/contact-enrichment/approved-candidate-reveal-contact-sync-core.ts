// Agente 2A — El teléfono revelado de un candidato APROBADO llega solo a su contacto oficial
// (AGENT2A-APPROVED-REVEAL-CONTACT-SYNC).
//
// EL HUECO QUE CIERRA. Revelar un teléfono es asíncrono: el número llega por el aviso de Apollo,
// por la pata Lusha del waterfall, por la recuperación (cron) o por un acierto de caché, y esos
// cuatro caminos escriben SÓLO en el candidato. La proyección al contacto oficial (la 128/131) y
// la segunda fase hacia HubSpot únicamente corrían desde la ficha del contacto, mientras estaba
// abierta o con «Usar teléfono ya obtenido». Si el reveal se pidió desde la revisión del
// candidato, o la ficha se cerró antes de que el proveedor contestara, el contacto aprobado se
// quedaba sin teléfono en SellUp y en HubSpot.
//
// QUÉ HACE. Justo después de que un camino de reveal guarde un número en un candidato:
//   1. si el candidato está APROBADO y tiene contacto oficial (`matched_contacts_id`), se
//      proyecta su colección sobre ese contacto con LA MISMA RPC que usa la ficha (128/131);
//   2. si esa proyección dejó un pendiente NUEVO de HubSpot, corre LA MISMA segunda fase
//      (`runContactHubSpotAutoPhoneUpdate`), que para la procedencia `reveal` sólo llena campos
//      vacíos (`planRevealedPhonesForHubSpot`).
// No hay una segunda implementación de nada: sólo un disparador más para piezas que ya existen.
//
// QUÉ NO HACE. No llama a proveedores, no reserva ni gasta créditos, no decide el teléfono que
// viaja y no construye un PATCH. NUNCA lanza: el reveal ya ocurrió y ya se cobró.
//
// Sin red, sin DB, sin reloj propios: todo inyectado.

import type { ContactAutoPhoneUpdateReport } from '@/modules/contacts/contact-hubspot-auto-phone-update-core';
import {
  didProjectionLeaveHubSpotPendingChange,
  type ProjectApprovedCandidatePhonesOutcome,
} from './post-approval-reveal-core';

export const APPROVED_REVEAL_CONTACT_SYNC_HITO = 'AGENT2A-APPROVED-REVEAL-CONTACT-SYNC';

export interface ApprovedRevealContactSyncCandidate {
  id: string;
  status: string | null;
  /** El contacto oficial que creó la aprobación. */
  matchedContactsId: string | null;
  /** Quien pidió el reveal (`phone_revealed_by`): el actor de la proyección y del sync. */
  revealedBy: string | null;
}

export type ApprovedRevealContactSyncOutcome =
  /** No se pudo leer el candidato. */
  | 'candidate_unavailable'
  /** El candidato no está aprobado: no hay contacto oficial al que llevar el número. */
  | 'not_approved'
  /** Aprobado pero sin contacto oficial durable. Fail-closed: nada se busca por parecido. */
  | 'no_official_contact'
  /** No se sabe quién pidió el reveal: no hay actor que firme la escritura del contacto. */
  | 'no_actor'
  /** La RPC de proyección no está desplegada. */
  | 'projection_unavailable'
  /** La proyección no se pudo ejecutar o la base la rechazó. */
  | 'projection_failed'
  /** Proyectado; HubSpot no quedó con nada nuevo pendiente (o no hay actor para la fase 2). */
  | 'projected'
  /** Proyectado y la segunda fase hacia HubSpot corrió. */
  | 'projected_and_synced';

export interface ApprovedRevealContactSyncReport {
  outcome: ApprovedRevealContactSyncOutcome;
  contactId: string | null;
  projectionStatus: string | null;
  phonesInserted: number;
  hubspotAutoUpdate: ContactAutoPhoneUpdateReport | null;
}

export interface ApprovedRevealContactSyncDeps {
  loadCandidate: (candidateId: string) => Promise<ApprovedRevealContactSyncCandidate | null>;
  checkProjectionCapability: () => Promise<boolean>;
  project: (args: {
    candidateId: string;
    contactId: string;
    actorId: string;
  }) => Promise<ProjectApprovedCandidatePhonesOutcome | null>;
  runHubSpotPhoneSyncFollowUp: (
    contactId: string,
    actorId: string,
  ) => Promise<ContactAutoPhoneUpdateReport>;
}

function clean(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Lleva el teléfono revelado de un candidato aprobado a su contacto oficial. NUNCA lanza. */
export async function runApprovedCandidateRevealContactSync(
  candidateId: string,
  deps: ApprovedRevealContactSyncDeps,
): Promise<ApprovedRevealContactSyncReport> {
  const report = (
    outcome: ApprovedRevealContactSyncOutcome,
    extra: Partial<ApprovedRevealContactSyncReport> = {},
  ): ApprovedRevealContactSyncReport => ({
    outcome,
    contactId: null,
    projectionStatus: null,
    phonesInserted: 0,
    hubspotAutoUpdate: null,
    ...extra,
  });

  let candidate: ApprovedRevealContactSyncCandidate | null;
  try {
    candidate = await deps.loadCandidate(candidateId);
  } catch {
    return report('candidate_unavailable');
  }
  if (!candidate) return report('candidate_unavailable');
  if (candidate.status !== 'approved') return report('not_approved');

  const contactId = clean(candidate.matchedContactsId);
  if (!contactId) return report('no_official_contact');

  const actorId = clean(candidate.revealedBy);
  if (!actorId) return report('no_actor', { contactId });

  let capable = false;
  try {
    capable = await deps.checkProjectionCapability();
  } catch {
    capable = false;
  }
  if (!capable) return report('projection_unavailable', { contactId });

  let projected: ProjectApprovedCandidatePhonesOutcome | null = null;
  try {
    projected = await deps.project({ candidateId: candidate.id, contactId, actorId });
  } catch {
    projected = null;
  }
  if (!projected || projected.status !== 'projected') {
    return report('projection_failed', { contactId, projectionStatus: projected?.status ?? null });
  }

  const base = {
    contactId,
    projectionStatus: projected.status,
    phonesInserted: projected.phonesInserted,
  };
  // La MISMA puerta que la ficha: sólo un pendiente NUEVO sale a la red.
  if (!didProjectionLeaveHubSpotPendingChange(projected.hubspotSyncTransition)) {
    return report('projected', base);
  }
  try {
    const followUp = await deps.runHubSpotPhoneSyncFollowUp(contactId, actorId);
    return report('projected_and_synced', { ...base, hubspotAutoUpdate: followUp });
  } catch {
    return report('projected', base);
  }
}

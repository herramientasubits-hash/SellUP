// Agente 2A — Resumen de «Buscar contactos» de una empresa (puro, sin red ni React).
//
// Bryan 29-10: un solo número («Rumbo encontró 9 contactos») confunde porque mezcla lo que
// vino de HubSpot, lo que trajeron las otras fuentes y lo que ya estaba en «Por revisar» de
// búsquedas anteriores. Este módulo separa esas tres cifras (más los contactos de HubSpot
// que pasaron directo a Contactos) para el chat, el aviso del Centro de procesos y la
// decisión de abrir «Por revisar».

/** Lo mínimo del resultado de la búsqueda que hace falta para resumirla. */
export interface ContactSearchSummaryInput {
  reusedExistingCandidates?: number;
  providerCandidatesCreated?: { apollo: number | null; lusha: number | null } | null;
  hubspotFirstCandidates?: number;
  contactBankCandidates?: number;
  companySiteCandidates?: number;
  /** Candidatos de HubSpot de ESTA búsqueda que pasaron directo a Contactos. */
  hubspotAutoApprovedContacts?: number;
  /** Candidatos de HubSpot de búsquedas ANTERIORES que pasaron directo a Contactos. */
  hubspotAutoApprovedEarlierContacts?: number;
  /** Candidatos en «Por revisar» de búsquedas anteriores de la misma empresa (tras pasar los completos). */
  previousPendingReviewCandidates?: number;
  diagnosis?: {
    freeStages?: { hubspotFirst?: string } | null;
    hubspotFirst?: { hubspotContacts: number } | null;
  } | null;
}

export interface ContactSearchSummary {
  /** Contactos que tiene HubSpot de la empresa; null si «Primero HubSpot» no corrió. */
  hubspotTotal: number | null;
  /** Contactos de HubSpot que esta búsqueda trajo (a Contactos + a «Por revisar»). */
  hubspotBrought: number;
  /** De esos, los que pasaron directo a Contactos (tenían correo, teléfono y LinkedIn). */
  hubspotToContacts: number;
  /** De esos, los que quedaron en «Por revisar». */
  hubspotToReview: number;
  /** Nuevos de otras fuentes (Apollo, Lusha, banco de SellUp, sitio web), todos a «Por revisar». */
  otherSources: number;
  apollo: number;
  lusha: number;
  contactBank: number;
  companySite: number;
  /** Pendientes en «Por revisar» de búsquedas anteriores. */
  previousPending: number;
  /** Candidatos de HubSpot de búsquedas anteriores que ahora pasaron a Contactos. */
  earlierToContacts: number;
  /** Lo nuevo de esta búsqueda que quedó para revisar. */
  newForReview: number;
  /** Todo lo que hay para revisar de la empresa: lo nuevo más lo anterior. */
  totalForReview: number;
}

function count(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function summarizeContactSearch(result: ContactSearchSummaryInput): ContactSearchSummary {
  const apollo = count(result.providerCandidatesCreated?.apollo);
  const lusha = count(result.providerCandidatesCreated?.lusha);
  const contactBank = count(result.contactBankCandidates);
  const companySite = count(result.companySiteCandidates);
  const hubspotBrought = count(result.hubspotFirstCandidates);
  const hubspotToContacts = Math.min(count(result.hubspotAutoApprovedContacts), hubspotBrought);
  const hubspotToReview = hubspotBrought - hubspotToContacts;
  const otherSources = apollo + lusha + contactBank + companySite;
  // Sin el conteo nuevo (servidor anterior) se usa lo que el enrutador ya reportaba como
  // pendiente reutilizado: es un mínimo, nunca un invento.
  const previousPending =
    typeof result.previousPendingReviewCandidates === 'number'
      ? count(result.previousPendingReviewCandidates)
      : count(result.reusedExistingCandidates);
  const newForReview = hubspotToReview + otherSources;
  const hubspotStage = result.diagnosis?.hubspotFirst;
  return {
    hubspotTotal: hubspotStage ? count(hubspotStage.hubspotContacts) : null,
    hubspotBrought,
    hubspotToContacts,
    hubspotToReview,
    otherSources,
    apollo,
    lusha,
    contactBank,
    companySite,
    previousPending,
    earlierToContacts: count(result.hubspotAutoApprovedEarlierContacts),
    newForReview,
    totalForReview: newForReview + previousPending,
  };
}

/** «1 contacto» / «3 contactos». */
export function contactsCountLabel(n: number): string {
  return n === 1 ? '1 contacto' : `${n} contactos`;
}

/**
 * Una línea para el aviso del Centro de procesos:
 * «HubSpot: 5 (2 a Contactos) · Otras fuentes: 4 · Ya tenías 6 en «Por revisar»».
 */
export function contactSearchCountsLine(summary: ContactSearchSummary): string {
  const parts: string[] = [];
  if (summary.hubspotBrought > 0) {
    parts.push(
      summary.hubspotToContacts > 0
        ? `HubSpot: ${summary.hubspotBrought} (${summary.hubspotToContacts} a Contactos)`
        : `HubSpot: ${summary.hubspotBrought}`,
    );
  } else if (summary.hubspotTotal !== null) {
    parts.push('HubSpot: 0');
  }
  parts.push(`Otras fuentes: ${summary.otherSources}`);
  if (summary.previousPending > 0) parts.push(`Ya tenías ${summary.previousPending} en «Por revisar»`);
  if (summary.earlierToContacts > 0) parts.push(`${summary.earlierToContacts} de antes a Contactos`);
  return parts.join(' · ');
}

// ── Contactos de HubSpot completos ───────────────────────────────────────────

/** Lo mínimo de un candidato para saber si es un contacto de HubSpot completo. */
export interface HubSpotCompletenessInput {
  source: string | null | undefined;
  email: string | null | undefined;
  phone: string | null | undefined;
  linkedin_url: string | null | undefined;
}

function filled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * ¿Es un contacto de HubSpot con correo, teléfono y LinkedIn? Bryan 29-10: ese no necesita
 * revisión — se aprueba solo y pasa directo a Contactos. Los demás (y todo lo de Apollo,
 * Lusha, el banco o el sitio web) siguen esperando a una persona en «Por revisar».
 */
export function isCompleteHubSpotCandidate(candidate: HubSpotCompletenessInput): boolean {
  return (
    candidate.source === 'hubspot' &&
    filled(candidate.email) &&
    filled(candidate.phone) &&
    filled(candidate.linkedin_url)
  );
}

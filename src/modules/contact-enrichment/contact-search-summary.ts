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
  /** Contactos aprobados de la empresa, de esta búsqueda y de las anteriores (Bryan 04-11). */
  approvedContactsTotal?: number;
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
  /** Aprobados en esta búsqueda: los de HubSpot completos, de ahora y de antes. */
  approvedNow: number;
  /** Aprobados de la empresa en total (anteriores + los de ahora). */
  approvedTotal: number;
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
  const earlierToContacts = count(result.hubspotAutoApprovedEarlierContacts);
  const approvedNow = hubspotToContacts + earlierToContacts;
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
    earlierToContacts,
    newForReview,
    totalForReview: newForReview + previousPending,
    approvedNow,
    // Sin el total (servidor anterior o conteo fallido) se muestra al menos lo aprobado ahora.
    approvedTotal: Math.max(count(result.approvedContactsTotal), approvedNow),
  };
}

/** «1 contacto» / «3 contactos». */
export function contactsCountLabel(n: number): string {
  return n === 1 ? '1 contacto' : `${n} contactos`;
}

/** Las cifras que muestran el aviso, el Centro de procesos, el chat y el reporte del lote. */
export interface ContactCounts {
  /** Aprobados de la empresa (o del lote): anteriores + los de ahora. */
  approvedTotal: number;
  /** De esos, los aprobados en esta búsqueda. */
  approvedNow: number;
  /** Por aprobar que encontró esta búsqueda. */
  foundForReview: number;
  /** Por aprobar que ya estaban de búsquedas anteriores. */
  previousPending: number;
}

export function contactCountsFromSummary(summary: ContactSearchSummary): ContactCounts {
  return {
    approvedTotal: summary.approvedTotal,
    approvedNow: summary.approvedNow,
    foundForReview: summary.newForReview,
    previousPending: summary.previousPending,
  };
}

/**
 * Bryan 04-11 — las dos líneas de siempre, aunque sean cero:
 *   «7 contactos aprobados | 2 contactos nuevos»
 *   «9 contactos por aprobar | 3 encontrados, 6 de ejecuciones anteriores»
 */
export function contactCountLines(counts: ContactCounts): [string, string] {
  const forReview = counts.foundForReview + counts.previousPending;
  const approved = `${counts.approvedTotal} ${counts.approvedTotal === 1 ? 'contacto aprobado' : 'contactos aprobados'}`;
  const approvedNow = `${counts.approvedNow} ${counts.approvedNow === 1 ? 'contacto nuevo' : 'contactos nuevos'}`;
  const pending = `${forReview} ${forReview === 1 ? 'contacto por aprobar' : 'contactos por aprobar'}`;
  const found = `${counts.foundForReview} ${counts.foundForReview === 1 ? 'encontrado' : 'encontrados'}`;
  return [
    `${approved} | ${approvedNow}`,
    `${pending} | ${found}, ${counts.previousPending} de ejecuciones anteriores`,
  ];
}

/** Suma las cifras de varias empresas (el aviso y el mensaje final del lote). */
export function sumContactCounts(list: readonly ContactCounts[]): ContactCounts {
  return list.reduce<ContactCounts>(
    (acc, c) => ({
      approvedTotal: acc.approvedTotal + c.approvedTotal,
      approvedNow: acc.approvedNow + c.approvedNow,
      foundForReview: acc.foundForReview + c.foundForReview,
      previousPending: acc.previousPending + c.previousPending,
    }),
    { approvedTotal: 0, approvedNow: 0, foundForReview: 0, previousPending: 0 },
  );
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

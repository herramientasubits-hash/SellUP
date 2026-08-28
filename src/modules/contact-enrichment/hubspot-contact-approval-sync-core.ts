// Agente 2A — Antesala del auto-sync: resuelve la empresa ANTES de delegar en el motor de
// contacto (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Esto es lo que hace que `MISSING_HUBSPOT_COMPANY` deje de ser el desenlace normal: por el
// momento en que `deps.syncContact` (que ES `runContactHubSpotAutoSync`, sin cambios) se
// invoca, la empresa YA está resuelta —creada, ya existía, o vinculada tras revisión humana—, o
// no se invoca en absoluto.

export type ContactHubSpotApprovalSyncOutcome =
  | { outcome: 'no_account' }
  | { outcome: 'company_unavailable' }
  | { outcome: 'waiting_company_review' }
  | {
      outcome: string;
      attempted: boolean;
      hubspotContactId: string | null;
      syncResult: unknown;
      blockedReason: unknown;
    };

export interface ContactHubSpotApprovalSyncDeps {
  loadContactAccountId: (contactId: string) => Promise<string | null>;
  resolveCompany: (
    accountId: string,
  ) => Promise<{ status: string; hubspotCompanyId?: string }>;
  syncContact: (contactId: string) => Promise<{
    outcome: string;
    attempted: boolean;
    hubspotContactId: string | null;
    syncResult: unknown;
    blockedReason: unknown;
  }>;
  markWaitingForCompanyReview: (contactId: string) => Promise<void>;
}

export async function runContactHubSpotApprovalSync(
  contactId: string,
  deps: ContactHubSpotApprovalSyncDeps,
): Promise<ContactHubSpotApprovalSyncOutcome> {
  const accountId = await deps.loadContactAccountId(contactId);
  if (!accountId) return { outcome: 'no_account' };

  const company = await deps.resolveCompany(accountId);

  if (company.status === 'pending_review') {
    await deps.markWaitingForCompanyReview(contactId);
    return { outcome: 'waiting_company_review' };
  }

  if (company.status !== 'ready') {
    return { outcome: 'company_unavailable' };
  }

  return deps.syncContact(contactId);
}

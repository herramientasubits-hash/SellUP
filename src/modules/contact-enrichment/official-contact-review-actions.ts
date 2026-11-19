'use server';

// Agente 2A — «Revisión» de un contacto APROBADO (AGENT2A-CONTACT-APPROVED-REVIEW, Bryan 19-11).
//
//   * `openOfficialContactReviewAction` — resuelve (o crea, D6) el candidato de origen y devuelve
//     lo que la ficha del candidato necesita para abrirse en modo revisión.
//   * `getOfficialContactReviewCandidateAction` — la lectura de ese candidato (aprobado y apuntando
//     al contacto), con el alcance del CONTACTO.
//   * `previewOfficialContactReviewSaveAction` — el resumen de cambios ANTES de aplicar.
//   * `saveOfficialContactReviewAction` — «Guardar» (y el guardado al cerrar): lleva al contacto y
//     a HubSpot lo que el candidato tiene y el contacto no, con las piezas que ya existen (correo
//     principal / personal, teléfonos con la proyección 128/131/169, LinkedIn, cargo). Aplica lo
//     que puede y dice qué faltó; nada se deshace. NO reutiliza la RPC 116 (la aprobación).
//   * `moveOfficialContactCompanyAction` — empresa elegida a mano: si es de quien revisa, se cambia
//     en el MISMO contacto; si es de otro dueño, no tiene dueño o no existe en SellUp, va por
//     «Cambió de empresa» (opción A).
//
// Quien ve el contacto puede abrir la revisión y guardar (Bryan 19-11). Gastar créditos sigue
// exigiendo el rol de revelar (lo revalida cada acción de reveal), y archivar por cambio de
// empresa también (la excepción acotada de #905).

import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  isApolloPhoneRevealEnabled,
  isLushaPhoneRevealFallbackEnabled,
  isPhoneRevealWaterfallEnabled,
} from '@/lib/feature-flags.server';
import { currentScopeUserIds } from '@/modules/access/record-scope.server';
import { getContactById, updateContact } from '@/modules/contacts/actions';
import { logContactAudit } from '@/modules/contacts/contact-audit.server';
import { resolveCompanyForContactEnrichment } from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import { setHubSpotContactJobTitle } from '@/server/integrations/hubspot-contact-sync';
import { getApprovedReviewCandidateForContact } from './actions';
import type { PendingContactCandidate } from './types';
import { requireActiveActor } from './current-actor.server';
import { canSeeOfficialContact } from './candidate-scope.server';
import { isPhoneRevealRoleAuthorized } from './phone-reveal-authorized-roles';
import { LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS } from './lusha-phone-fallback-core';
import { resolveOfficialContactSourceCandidateId } from './post-approval-reveal-core';
import {
  ensureOfficialContactSourceCandidate,
  fillSourceCandidateChannelsFromContact,
  readContactWithSourceCandidate,
  syncApprovedCandidateChannelsOntoContact,
} from './official-contact-identity-completion.server';
import { applyPersonalEmail, applySameCompanyNewEmail } from './official-contact-email-check.server';
import { pushCandidatePhoneRevealToHubSpot, pushCandidateRevealToHubSpot } from './candidate-reveal-hubspot-push.server';
import { readCandidateStoredPhones } from './candidate-stored-phones-read';
import { readOfficialContactStoredPhones } from './official-contact-stored-phones-read';
import { moveHubSpotContactPrimaryCompany } from './contact-company-change.server';
import { runManualCompanyChangeForContact } from './contact-company-change-runner.server';
import {
  parseCompanyReassignmentSelection,
  pickReassignmentCompany,
  CANDIDATE_COMPANY_REASSIGNMENT_KEY,
  type CandidateCompanyReassignmentV1,
} from './candidate-company-reassignment-core';
import {
  OFFICIAL_CONTACT_REVIEW_COPY,
  OFFICIAL_CONTACT_REVIEW_HITO,
  appendReviewTrail,
  decideReviewCompanyMove,
  describeOfficialContactReviewChanges,
  planOfficialContactReviewChanges,
  reviewPlanHasChanges,
  type ReviewChangePlan,
} from './official-contact-review-core';

// ── Lecturas ────────────────────────────────────────────────────────

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function clean(id: unknown): string {
  return typeof id === 'string' ? id.trim() : '';
}

interface ReviewPair {
  contact: {
    id: string;
    accountId: string;
    accountName: string | null;
    accountDomain: string | null;
    accountHubSpotCompanyId: string | null;
    email: string | null;
    linkedinUrl: string | null;
    jobTitle: string | null;
    hubspotContactId: string | null;
    mobilePhone: string | null;
    mainPhone: string | null;
  };
  candidate: {
    id: string;
    email: string | null;
    linkedinUrl: string | null;
    title: string | null;
    scalarPhone: string | null;
    enrichmentMetadata: Record<string, unknown>;
  };
}

/**
 * El contacto y su candidato de origen, sólo si el vínculo es DURABLE: el contacto apunta al
 * candidato (`metadata.source_candidate_id`), el candidato está aprobado y apunta al contacto, y el
 * contacto no está archivado. Lo que el navegador manda es una confirmación, nunca una orden.
 */
async function loadReviewPair(contactId: string, candidateId: string): Promise<ReviewPair | null> {
  const admin = createSupabaseAdminClient();
  const [{ data: contactRow }, { data: candidateRow }] = await Promise.all([
    admin
      .from('contacts')
      .select(
        'id, account_id, email, linkedin_url, job_title, hubspot_contact_id, mobile_phone, phone, archived_at, metadata, account:account_id ( name, domain, hubspot_company_id )',
      )
      .eq('id', contactId)
      .maybeSingle(),
    admin
      .from('contact_enrichment_candidates')
      .select('id, status, matched_contacts_id, email, linkedin_url, title, phone, enrichment_metadata')
      .eq('id', candidateId)
      .maybeSingle(),
  ]);
  const c = contactRow as Record<string, unknown> | null;
  const k = candidateRow as Record<string, unknown> | null;
  if (!c || !k || str(c.archived_at)) return null;
  const durable = resolveOfficialContactSourceCandidateId(c.metadata);
  if (durable.kind !== 'resolved' || durable.candidateId !== candidateId) return null;
  if (k.status !== 'approved' || k.matched_contacts_id !== contactId) return null;
  const account = one(c.account as Record<string, unknown> | Record<string, unknown>[] | null);
  return {
    contact: {
      id: c.id as string,
      accountId: c.account_id as string,
      accountName: str(account?.name),
      accountDomain: str(account?.domain),
      accountHubSpotCompanyId: str(account?.hubspot_company_id),
      email: str(c.email),
      linkedinUrl: str(c.linkedin_url),
      jobTitle: str(c.job_title),
      hubspotContactId: str(c.hubspot_contact_id),
      mobilePhone: str(c.mobile_phone),
      mainPhone: str(c.phone),
    },
    candidate: {
      id: k.id as string,
      email: str(k.email),
      linkedinUrl: str(k.linkedin_url),
      title: str(k.title),
      scalarPhone: str(k.phone),
      enrichmentMetadata:
        k.enrichment_metadata && typeof k.enrichment_metadata === 'object' && !Array.isArray(k.enrichment_metadata)
          ? (k.enrichment_metadata as Record<string, unknown>)
          : {},
    },
  };
}

function digits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '');
}

/** Números del candidato que el contacto todavía no tiene (por dígitos). Fail-soft: [] si no se lee. */
async function candidatePhonesMissingOnContact(pair: ReviewPair): Promise<string[]> {
  let candidateNumbers: string[] = [];
  try {
    const read = await readCandidateStoredPhones(pair.candidate.id);
    candidateNumbers = read.phones
      .filter((row) => !row.suppressed_at && row.phone_status !== 'invalid')
      .map((row) => row.display_phone ?? row.normalized_phone ?? '')
      .filter((n) => n.trim().length > 0);
  } catch {
    candidateNumbers = [];
  }
  if (pair.candidate.scalarPhone) candidateNumbers.unshift(pair.candidate.scalarPhone);
  const known = new Set<string>([digits(pair.contact.mobilePhone), digits(pair.contact.mainPhone)].filter((d) => d.length > 0));
  try {
    const official = await readOfficialContactStoredPhones(pair.contact.id);
    for (const row of official.phones) {
      if (row.suppressed_at) continue;
      const d = digits(row.normalized_phone ?? row.display_phone);
      if (d) known.add(d);
    }
  } catch {
    // Sin la colección oficial se compara con los escalares.
  }
  const out: string[] = [];
  for (const number of candidateNumbers) {
    const d = digits(number);
    if (d.length < 6 || known.has(d)) continue;
    known.add(d);
    out.push(number.trim());
  }
  return out;
}

function planFor(pair: ReviewPair): ReviewChangePlan {
  return planOfficialContactReviewChanges({
    contact: {
      email: pair.contact.email,
      linkedinUrl: pair.contact.linkedinUrl,
      jobTitle: pair.contact.jobTitle,
      accountDomain: pair.contact.accountDomain,
    },
    candidate: { email: pair.candidate.email, linkedinUrl: pair.candidate.linkedinUrl, title: pair.candidate.title },
  });
}

// ── Abrir ───────────────────────────────────────────────────────────

export interface OfficialContactReviewSheetFlags {
  phoneRevealEnabled: boolean;
  phoneRevealAuthorized: boolean;
  lushaPhoneFallbackEnabled: boolean;
  lushaPhoneFallbackAuthorized: boolean;
  phoneRevealWaterfallEnabled: boolean;
  phoneRevealWaterfallAuthorized: boolean;
}

export type OpenOfficialContactReviewResult =
  | { ok: true; candidateId: string; flags: OfficialContactReviewSheetFlags }
  | { ok: false; message: string };

export async function openOfficialContactReviewAction(input: { contactId: string }): Promise<OpenOfficialContactReviewResult> {
  const contactId = clean(input?.contactId);
  const { internalUserId, roleKey } = await requireActiveActor();
  if (!contactId || !(await canSeeOfficialContact(await createClient(), contactId))) {
    return { ok: false, message: OFFICIAL_CONTACT_REVIEW_COPY.unavailable };
  }
  try {
    let { contact, candidate } = await readContactWithSourceCandidate(contactId);
    if (!contact || contact.archivedAt) return { ok: false, message: OFFICIAL_CONTACT_REVIEW_COPY.unavailable };
    // D6: un contacto sin candidato de origen (creado a mano o traído antes) recibe uno.
    if (!candidate || candidate.matchedContactsId !== contact.id) {
      await ensureOfficialContactSourceCandidate(contactId, internalUserId);
      ({ contact, candidate } = await readContactWithSourceCandidate(contactId));
    }
    if (!contact || !candidate || candidate.matchedContactsId !== contact.id || candidate.status !== 'approved') {
      return { ok: false, message: OFFICIAL_CONTACT_REVIEW_COPY.openFailed };
    }
    // La revisión parte de lo que el contacto tiene hoy (sólo llena vacíos del candidato).
    await fillSourceCandidateChannelsFromContact(contact, candidate);
    const authorized = isPhoneRevealRoleAuthorized(roleKey);
    return {
      ok: true,
      candidateId: candidate.id,
      flags: {
        phoneRevealEnabled: isApolloPhoneRevealEnabled(),
        phoneRevealAuthorized: authorized,
        lushaPhoneFallbackEnabled: isLushaPhoneRevealFallbackEnabled(),
        lushaPhoneFallbackAuthorized: !!roleKey && LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS.includes(roleKey),
        phoneRevealWaterfallEnabled: isPhoneRevealWaterfallEnabled(),
        phoneRevealWaterfallAuthorized: authorized,
      },
    };
  } catch {
    return { ok: false, message: OFFICIAL_CONTACT_REVIEW_COPY.openFailed };
  }
}

export async function getOfficialContactReviewCandidateAction(input: {
  contactId: string;
  candidateId: string;
}): Promise<PendingContactCandidate | null> {
  return getApprovedReviewCandidateForContact(clean(input?.candidateId), clean(input?.contactId));
}

// ── Resumen y «Guardar» ─────────────────────────────────────────────

export type PreviewOfficialContactReviewResult =
  | { ok: true; lines: string[]; hasChanges: boolean }
  | { ok: false; message: string };

export async function previewOfficialContactReviewSaveAction(input: {
  contactId: string;
  candidateId: string;
}): Promise<PreviewOfficialContactReviewResult> {
  const contactId = clean(input?.contactId);
  const candidateId = clean(input?.candidateId);
  await requireActiveActor();
  if (!contactId || !candidateId || !(await canSeeOfficialContact(await createClient(), contactId))) {
    return { ok: false, message: OFFICIAL_CONTACT_REVIEW_COPY.unavailable };
  }
  const pair = await loadReviewPair(contactId, candidateId);
  if (!pair) return { ok: false, message: OFFICIAL_CONTACT_REVIEW_COPY.unavailable };
  const plan = planFor(pair);
  const newPhones = await candidatePhonesMissingOnContact(pair);
  const lines = describeOfficialContactReviewChanges({
    plan,
    newPhones,
    contactEmail: pair.contact.email,
    contactJobTitle: pair.contact.jobTitle,
  });
  return { ok: true, lines, hasChanges: reviewPlanHasChanges(plan) || newPhones.length > 0 };
}

export interface SaveOfficialContactReviewResult {
  ok: boolean;
  applied: string[];
  failed: string[];
  /** Avisos que no son fallas (p. ej. un correo de otra empresa que no se aplica aquí). */
  notes: string[];
  message: string;
}

export async function saveOfficialContactReviewAction(input: {
  contactId: string;
  candidateId: string;
  trigger?: 'save' | 'close';
}): Promise<SaveOfficialContactReviewResult> {
  const contactId = clean(input?.contactId);
  const candidateId = clean(input?.candidateId);
  const trigger = input?.trigger === 'close' ? 'close' : 'save';
  const { internalUserId } = await requireActiveActor();
  const unavailable: SaveOfficialContactReviewResult = {
    ok: false,
    applied: [],
    failed: [],
    notes: [],
    message: OFFICIAL_CONTACT_REVIEW_COPY.unavailable,
  };
  if (!contactId || !candidateId || !(await canSeeOfficialContact(await createClient(), contactId))) return unavailable;
  const pair = await loadReviewPair(contactId, candidateId);
  if (!pair) return unavailable;

  const plan = planFor(pair);
  const newPhones = await candidatePhonesMissingOnContact(pair);
  const applied: string[] = [];
  const failed: string[] = [];
  const notes: string[] = [];

  // 1. Correo.
  const email = plan.email;
  if (email?.kind === 'same_company') {
    const report = await applySameCompanyNewEmail({ contactId, candidateId, newEmail: email.email, actorId: internalUserId }).catch(
      () => ({ contactUpdated: false, hubspot: 'error' }),
    );
    if (report.contactUpdated) applied.push(`correo principal ${email.email}`);
    else failed.push('el correo nuevo');
  } else if (email?.kind === 'personal') {
    const report = await applyPersonalEmail({ contactId, candidateId, email: email.email, provider: null, actorId: internalUserId }).catch(
      () => ({ contactUpdated: false, hubspot: 'error' }),
    );
    if (report.contactUpdated) applied.push(`correo personal ${email.email}`);
    else failed.push('el correo personal');
  } else if (email?.kind === 'other_company') {
    notes.push(`El correo ${email.email} es de otra empresa: no se cambió. Usa «Enviar a revisión» si ya no trabaja aquí.`);
  }

  // 2. Correo / LinkedIn que faltaban: sólo vacíos (la misma regla de siempre) y su envío a HubSpot.
  if (email?.kind === 'fill' || plan.linkedinUrl) {
    const synced = await syncApprovedCandidateChannelsOntoContact(candidateId);
    if (email?.kind === 'fill') {
      if (synced.updated.includes('email')) applied.push(`correo ${email.email}`);
      else failed.push('el correo');
    }
    if (plan.linkedinUrl) {
      if (synced.updated.includes('linkedin_url')) applied.push('LinkedIn');
      else failed.push('el LinkedIn');
    }
    if (synced.updated.includes('linkedin_url')) await pushCandidateRevealToHubSpot(candidateId, 'reveal_linkedin');
    if (synced.updated.includes('email')) await pushCandidateRevealToHubSpot(candidateId, 'reveal_email');
  }

  // 3. Teléfonos: la proyección del candidato aprobado (128/131/169, regla 164) y HubSpot al
  //    primer campo vacío. La misma pieza que usa un reveal que llega después de aprobar.
  if (newPhones.length > 0) {
    try {
      await pushCandidatePhoneRevealToHubSpot(candidateId, newPhones[0], 'reveal_phone_recovery');
      const after = await loadReviewPair(contactId, candidateId);
      const stillMissing = after ? await candidatePhonesMissingOnContact(after) : newPhones;
      const landed = newPhones.filter((n) => !stillMissing.includes(n));
      if (landed.length > 0) applied.push(`teléfonos ${landed.join(', ')}`);
      if (stillMissing.length > 0) failed.push(`los teléfonos ${stillMissing.join(', ')}`);
    } catch {
      failed.push(`los teléfonos ${newPhones.join(', ')}`);
    }
  }

  // 4. Cargo.
  if (plan.jobTitle) {
    const saved = await updateContact(contactId, { job_title: plan.jobTitle }).catch(() => ({ success: false }));
    if (saved.success) {
      applied.push(`cargo ${plan.jobTitle}`);
      if (pair.contact.hubspotContactId) {
        await setHubSpotContactJobTitle(pair.contact.hubspotContactId, plan.jobTitle).catch(() => null);
      }
    } else {
      failed.push('el cargo');
    }
  }

  // 5. Rastro (quién, cuándo, qué). Sólo si hubo algo.
  if (applied.length > 0 || failed.length > 0) {
    const fresh = await getContactById(contactId).catch(() => null);
    if (fresh) {
      await updateContact(contactId, {
        metadata: appendReviewTrail(fresh.metadata, {
          hito: OFFICIAL_CONTACT_REVIEW_HITO,
          candidate_id: candidateId,
          saved_at: new Date().toISOString(),
          saved_by: internalUserId,
          trigger,
          changes: applied,
          failed,
        }),
      }).catch(() => null);
    }
  }

  const message =
    applied.length === 0 && failed.length === 0
      ? OFFICIAL_CONTACT_REVIEW_COPY.nothingToSave
      : failed.length > 0
        ? `${applied.length > 0 ? `${OFFICIAL_CONTACT_REVIEW_COPY.saved(applied.length)} ` : ''}${OFFICIAL_CONTACT_REVIEW_COPY.partial(failed)}`
        : OFFICIAL_CONTACT_REVIEW_COPY.saved(applied.length);
  return { ok: failed.length === 0, applied, failed, notes, message };
}

// ── Empresa elegida a mano ──────────────────────────────────────────

interface ReviewTargetAccount {
  id: string;
  owner_id: string | null;
  name: string | null;
  hubspot_company_id: string | null;
  domain: string | null;
}

export type MoveOfficialContactCompanyResult =
  | { ok: true; decision: 'same_company' | 'in_place' | 'company_change'; message: string; newCandidateId?: string }
  | { ok: false; message: string };

export async function moveOfficialContactCompanyAction(input: {
  contactId: string;
  candidateId: string;
  selection: unknown;
}): Promise<MoveOfficialContactCompanyResult> {
  const contactId = clean(input?.contactId);
  const candidateId = clean(input?.candidateId);
  const selection = parseCompanyReassignmentSelection(input?.selection);
  const { internalUserId, roleKey } = await requireActiveActor();
  if (!contactId || !candidateId || !selection || !(await canSeeOfficialContact(await createClient(), contactId))) {
    return { ok: false, message: OFFICIAL_CONTACT_REVIEW_COPY.unavailable };
  }
  try {
    const pair = await loadReviewPair(contactId, candidateId);
    if (!pair) return { ok: false, message: OFFICIAL_CONTACT_REVIEW_COPY.unavailable };

    // La empresa elegida, con la misma búsqueda que «Reasignar empresa».
    const resolution = await resolveCompanyForContactEnrichment(
      selection.source === 'sellup' ? { sellupAccountId: selection.sellupAccountId } : { hubspotCompanyId: selection.hubspotCompanyId },
      { sellupScopeUserIds: await currentScopeUserIds() },
    );
    const company = pickReassignmentCompany(selection, resolution.candidates);
    if (!company) return { ok: false, message: 'No encontramos esa empresa. Vuelve a buscarla.' };

    // Su cuenta de SellUp (si existe) y su dueño.
    const admin = createSupabaseAdminClient();
    let account: ReviewTargetAccount | null = null;
    if (company.sellupAccountId) {
      const { data } = await admin
        .from('accounts')
        .select('id, owner_id, name, hubspot_company_id, domain')
        .eq('id', company.sellupAccountId)
        .is('archived_at', null)
        .maybeSingle();
      account = (data as ReviewTargetAccount | null) ?? null;
    } else if (company.hubspotCompanyId) {
      const { data } = await admin
        .from('accounts')
        .select('id, owner_id, name, hubspot_company_id, domain')
        .eq('hubspot_company_id', company.hubspotCompanyId)
        .is('archived_at', null)
        .limit(2);
      const rows = (data ?? []) as ReviewTargetAccount[];
      account = rows.length === 1 ? rows[0] : null;
    }

    const decision = decideReviewCompanyMove({
      actorId: internalUserId,
      contactAccountId: pair.contact.accountId,
      target: account ? { accountId: account.id, ownerId: account.owner_id } : null,
    });
    const companyName = account?.name ?? company.name;

    if (decision === 'same_company') {
      return { ok: true, decision, message: OFFICIAL_CONTACT_REVIEW_COPY.companySame(companyName) };
    }

    if (decision === 'company_change') {
      // Opción A (Bryan 19-11): archivar y candidato «Por revisar» en la empresa nueva. Archivar
      // sigue siendo la excepción acotada de #905: sólo los roles que pueden revelar.
      if (!isPhoneRevealRoleAuthorized(roleKey)) {
        return {
          ok: false,
          message:
            'Esa empresa es de otro responsable, no tiene responsable o no existe en SellUp: enviarlo a revisión allí lo puede hacer un administrador o un manager comercial.',
        };
      }
      const target = account
        ? { ...company, source: 'sellup' as const, sellupAccountId: account.id, hubspotCompanyId: account.hubspot_company_id ?? company.hubspotCompanyId }
        : company;
      const result = await runManualCompanyChangeForContact(contactId, internalUserId, target);
      if (!result.ok) return { ok: false, message: result.message };
      return { ok: true, decision, message: result.message, newCandidateId: result.candidateId };
    }

    // En el MISMO contacto: la empresa es de quien revisa.
    if (!account) return { ok: false, message: 'No encontramos la cuenta de esa empresa en SellUp.' };
    const nowIso = new Date().toISOString();
    const fresh = await getContactById(contactId);
    const metadata = appendReviewTrail(fresh?.metadata ?? {}, {
      hito: OFFICIAL_CONTACT_REVIEW_HITO,
      candidate_id: candidateId,
      saved_at: nowIso,
      saved_by: internalUserId,
      trigger: 'company_move',
      changes: [`empresa ${pair.contact.accountName ?? pair.contact.accountId} → ${companyName}`],
      failed: [],
    });
    const { error } = await admin
      .from('contacts')
      .update({ account_id: account.id, is_primary: false, metadata, updated_at: nowIso })
      .eq('id', contactId)
      .is('archived_at', null);
    if (error) return { ok: false, message: 'No pudimos cambiar la empresa del contacto.' };

    // El candidato de origen refleja la empresa nueva (la ficha de revisión la muestra).
    const reassignment: CandidateCompanyReassignmentV1 = {
      version: 1,
      account_id: account.id,
      hubspot_company_id: account.hubspot_company_id,
      company_name: companyName,
      company_domain: account.domain,
      country_code: company.countryCode ?? null,
      selected_source: selection.source,
      account_resolution: 'selected_sellup_account',
      reassigned_by: internalUserId,
      reassigned_at: nowIso,
      original: {
        account_id: pair.contact.accountId,
        hubspot_company_id: pair.contact.accountHubSpotCompanyId,
        company_name: pair.contact.accountName,
        company_domain: pair.contact.accountDomain,
      },
      original_company_consistency: null,
    };
    await admin
      .from('contact_enrichment_candidates')
      .update({ enrichment_metadata: { ...pair.candidate.enrichmentMetadata, [CANDIDATE_COMPANY_REASSIGNMENT_KEY]: reassignment } })
      .eq('id', candidateId)
      .eq('status', 'approved');

    // HubSpot: la empresa nueva como «Principal» y fuera las demás.
    let hubspot: string = 'not_in_hubspot';
    if (pair.contact.hubspotContactId && account.hubspot_company_id) {
      hubspot = await moveHubSpotContactPrimaryCompany(pair.contact.hubspotContactId, account.hubspot_company_id);
    } else if (pair.contact.hubspotContactId) {
      hubspot = 'no_hubspot_company';
    }

    await logContactAudit({
      contactId,
      accountId: account.id,
      actorUserId: internalUserId,
      actionType: 'contact_updated',
      details: {
        reason: 'company_moved_in_review',
        from_account_id: pair.contact.accountId,
        to_account_id: account.id,
        hubspot_company_move: hubspot,
      },
    });
    return { ok: true, decision, message: OFFICIAL_CONTACT_REVIEW_COPY.companyMovedInPlace(companyName) };
  } catch (err) {
    console.error('[official-contact-review] move company failed', {
      contactId,
      error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    });
    return { ok: false, message: 'No pudimos cambiar la empresa del contacto.' };
  }
}

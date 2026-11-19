/**
 * AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE (Bryan 18-11).
 *
 *  - qué significa el correo que trae el proveedor (casos A–G);
 *  - un correo de OTRA empresa nunca se escribe en el contacto/candidato viejo;
 *  - «Verificar correo» pregunta por LinkedIn sin la empresa vieja y no escribe el correo;
 *  - un intento sin fruto sólo bloquea con los MISMOS datos;
 *  - HubSpot: correo nuevo como principal (el anterior como adicional), personal como adicional,
 *    y al aprobar el cambio de empresa la nueva queda como principal y las demás se desasocian;
 *  - el candidato de la empresa nueva: sin teléfonos viejos, sin la empresa vieja de HubSpot;
 *  - archivar / desarchivar sólo por este flujo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  classifyEmailChange,
  domainRootLabel,
  emailDomainOf,
  hasPendingCompanyChange,
  readEmailCheckBlock,
  sameCompanyDomain,
  type EmailCheckBlock,
} from '../email-change-classifier-core';
import {
  evaluateCandidateIdentityCompletion,
  identityCompletionInputKey,
  runCandidateIdentityCompletion,
  type IdentityCompletionCandidate,
  type IdentityCompletionDeps,
  type IdentityLookup,
  type IdentityLookupQuery,
} from '../candidate-identity-completion-core';
import { runCandidateEmailVerification } from '../candidate-email-verification-core';
import {
  addHubSpotAdditionalEmail,
  makeHubSpotPrimaryEmail,
  moveHubSpotContactToCompany,
  planHubSpotCompanyReassociation,
  type HubSpotEmailDeps,
} from '../contact-hubspot-email-company-core';
import {
  buildCompanyChangeArchivePatch,
  buildCompanyChangeRestorePatch,
  buildCompanyChangeSearchData,
  buildContactCompanyChangeBlock,
  evaluateCompanyChangeConfirmation,
  evaluateCompanyChangeRestore,
  isCurrentCompany,
  planCompanyChangeHubSpotPush,
  readContactCompanyChange,
  resolveCompanyChangeHubSpotContactId,
  withCompanyChangeOutcome,
  type CompanyChangeContact,
} from '../contact-company-change-core';
import { buildQuickSearchCandidateRow } from '../contact-quick-search-candidate-core';
import {
  buildOfficialContactSourceCandidateRow,
  classifyOfficialContactChannelOffer,
} from '../official-contact-identity-completion-core';
import { buildOfficialContactEmailState, employmentLine } from '../official-contact-email-check-view';
import { isHubSpotLookupImportRunSummary } from '../hubspot-contact-import-core';
import type { CurrentEmploymentSnapshot } from '../current-employment-check';

const root = process.cwd();
const code = (rel: string) =>
  readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const CE = 'src/modules/contact-enrichment';

// ── Clasificación ───────────────────────────────────────────────────

describe('qué significa el correo que trae el proveedor', () => {
  const base = { currentEmail: 'ana@weatherford.com', companyDomains: ['weatherford.com'] };

  it('dominios del mismo grupo', () => {
    assert.equal(domainRootLabel('weatherford.com.mx'), 'weatherford');
    assert.equal(domainRootLabel('mail.acme.co'), 'acme');
    assert.ok(sameCompanyDomain('weatherford.com', 'weatherford.com.mx'));
    assert.ok(sameCompanyDomain('acme.com', 'latam.acme.com'));
    assert.ok(!sameCompanyDomain('acme.com', 'otra.com'));
    assert.equal(emailDomainOf('Ana@WeatherFord.com'), 'weatherford.com');
  });

  it('A — mismo correo y sin señal de cambio', () => {
    assert.equal(classifyEmailChange({ ...base, foundEmail: 'ANA@weatherford.com', employment: { status: 'confirmed' } }).case, 'same_email');
  });

  it('B — otro correo de la misma empresa (o del mismo grupo)', () => {
    assert.equal(classifyEmailChange({ ...base, foundEmail: 'amarquez@weatherford.com.mx', employment: { status: 'confirmed' } }).case, 'same_company_new_email');
    assert.equal(classifyEmailChange({ ...base, foundEmail: 'amarquez@weatherford.com', employment: null }).case, 'same_company_new_email');
  });

  it('C — correo personal', () => {
    assert.equal(classifyEmailChange({ ...base, foundEmail: 'ana@gmail.com', employment: { status: 'other_company' } }).case, 'personal_email');
  });

  it('D — correo de otra empresa', () => {
    assert.equal(classifyEmailChange({ ...base, foundEmail: 'ana@nueva.com', employment: { status: 'other_company' } }).case, 'company_change');
    assert.equal(classifyEmailChange({ ...base, foundEmail: 'ana@nueva.com', employment: null }).case, 'company_change');
  });

  it('E — señales contradictorias', () => {
    assert.equal(classifyEmailChange({ ...base, foundEmail: 'ana@weatherford.com', employment: { status: 'other_company' } }).case, 'conflicting');
    assert.equal(classifyEmailChange({ ...base, foundEmail: 'amarquez@weatherford.com', employment: { status: 'other_company' } }).case, 'conflicting');
    assert.equal(classifyEmailChange({ ...base, foundEmail: 'ana@otrodominio.com', employment: { status: 'confirmed' } }).case, 'conflicting');
  });

  it('F / G — sin correo', () => {
    assert.equal(classifyEmailChange({ ...base, foundEmail: null, employment: { status: 'other_company' } }).case, 'left_no_email');
    assert.equal(classifyEmailChange({ ...base, foundEmail: null, employment: { status: 'confirmed' } }).case, 'no_new_email');
  });

  it('sin dominio con qué comparar, manda el empleo', () => {
    const noDomain = { currentEmail: null, companyDomains: [] as string[] };
    assert.equal(classifyEmailChange({ ...noDomain, foundEmail: 'ana@x.com', employment: null }).case, 'same_company_new_email');
    assert.equal(classifyEmailChange({ ...noDomain, foundEmail: 'ana@x.com', employment: { status: 'other_company' } }).case, 'company_change');
  });
});

// ── Identity completion: el correo de otra empresa no se guarda ─────

const ACTOR = { internalUserId: 'u-1', roleKey: 'admin' };
const NOW = '2026-11-18T12:00:00.000Z';

function candidate(overrides: Partial<IdentityCompletionCandidate> = {}): IdentityCompletionCandidate {
  return {
    id: 'cand-1',
    status: 'approved',
    source: 'hubspot',
    sourceContactId: '501',
    apolloPersonId: null,
    email: null,
    linkedinUrl: 'https://www.linkedin.com/in/ana-marquez',
    firstName: 'Ana',
    lastName: 'Márquez',
    fullName: 'Ana Márquez',
    companyName: 'Weatherford',
    companyDomain: 'weatherford.com',
    title: 'Gerente RH',
    enrichmentMetadata: {},
    ...overrides,
  };
}

function snapshotAt(orgName: string, domain: string): CurrentEmploymentSnapshot {
  return {
    has_history: true,
    roles: [{ organization_id: 'org-new', organization_name: orgName, title: 'Directora de Talento', start_date: '2026-03-01' }],
    organization: { id: 'org-new', name: orgName, domain },
  };
}

function deps(apollo: IdentityLookup, cand: IdentityCompletionCandidate, lusha?: IdentityLookup) {
  const persisted: Array<Record<string, unknown>> = [];
  const apolloQueries: IdentityLookupQuery[] = [];
  const lushaQueries: IdentityLookupQuery[] = [];
  const d: IdentityCompletionDeps = {
    actor: ACTOR,
    nowIso: NOW,
    loadCandidate: async () => cand,
    lookupApollo: async (q) => {
      apolloQueries.push(q);
      return apollo;
    },
    ...(lusha
      ? {
          lookupLusha: async (q: IdentityLookupQuery) => {
            lushaQueries.push(q);
            return lusha;
          },
        }
      : {}),
    persist: async (_id, patch) => {
      persisted.push(patch as unknown as Record<string, unknown>);
    },
    logUsage: async () => {},
  };
  return { d, persisted, apolloQueries, lushaQueries };
}

const USAGE = [{ provider_key: 'apollo' as const, operation_key: 'person_match', credits_used: 1, status: 'success' as const, results_returned: 1 }];

describe('«Revelar correo»: un correo de otra empresa no se guarda', () => {
  it('Apollo dice otra empresa y trae su correo: company_change_detected, nada escrito en el correo', async () => {
    const apollo: IdentityLookup = {
      kind: 'found',
      person: { id: 'ap-1', firstName: 'Ana', lastName: 'Márquez', linkedinUrl: null, email: 'ana@nueva.com', currentEmployment: snapshotAt('Nueva SA', 'nueva.com') },
      usage: USAGE,
    };
    const { d, persisted } = deps(apollo, candidate());
    const result = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'email', allowApproved: true }, d);
    assert.equal(result.status, 'company_change_detected');
    assert.equal(result.emailAvailable, false);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].email, undefined);
    const meta = persisted[0].enrichment_metadata as Record<string, unknown>;
    const check = readEmailCheckBlock(meta) as EmailCheckBlock;
    assert.equal(check.case, 'company_change');
    assert.equal(check.found_email, 'ana@nueva.com');
    assert.equal(check.employment?.current_company, 'Nueva SA');
    assert.equal(check.employment?.organization_domain, 'nueva.com');
    assert.ok(hasPendingCompanyChange(check));
  });

  it('correo de la misma empresa: se guarda como siempre (sin aviso)', async () => {
    const apollo: IdentityLookup = {
      kind: 'found',
      person: { id: 'ap-1', firstName: 'Ana', lastName: 'Márquez', linkedinUrl: null, email: 'ana@weatherford.com', currentEmployment: snapshotAt('Weatherford', 'weatherford.com') },
      usage: USAGE,
    };
    const { d, persisted } = deps(apollo, candidate());
    const result = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'email', allowApproved: true }, d);
    assert.equal(result.status, 'completed');
    assert.equal(persisted[0].email, 'ana@weatherford.com');
    assert.equal(readEmailCheckBlock(persisted[0].enrichment_metadata), null);
  });

  it('candidatos que no son de HubSpot: sólo con allowAnySource (ficha del contacto oficial)', async () => {
    const apollo: IdentityLookup = { kind: 'not_found', usage: USAGE };
    const blocked = deps(apollo, candidate({ source: 'apollo' }));
    assert.equal((await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'email', allowApproved: true }, blocked.d)).status, 'not_hubspot_candidate');
    const allowed = deps(apollo, candidate({ source: 'manual' }));
    assert.equal(
      (await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'email', allowApproved: true, allowAnySource: true }, allowed.d)).status,
      'not_found',
    );
  });
});

describe('un intento sin fruto sólo bloquea con los mismos datos', () => {
  const facts = { email: 'ana@weatherford.com', linkedinUrl: null, source: 'hubspot' };
  it('mismos datos: no se ofrece; datos nuevos: se vuelve a ofrecer; intento viejo sin huella: bloquea', () => {
    const key = identityCompletionInputKey(facts);
    const same = evaluateCandidateIdentityCompletion({ ...facts, enrichmentMetadata: { identity_completion: { outcome: 'not_found', input_key: key } } });
    assert.equal(same.canRevealLinkedin, false);
    const changed = evaluateCandidateIdentityCompletion({
      ...facts,
      email: 'ana.marquez@weatherford.com',
      enrichmentMetadata: { identity_completion: { outcome: 'not_found', input_key: key } },
    });
    assert.equal(changed.canRevealLinkedin, true);
    const legacy = evaluateCandidateIdentityCompletion({ ...facts, enrichmentMetadata: { identity_completion: { outcome: 'not_found' } } });
    assert.equal(legacy.canRevealLinkedin, false);
  });

  it('el intento guarda su huella', async () => {
    const { d, persisted } = deps({ kind: 'not_found', usage: USAGE }, candidate({ email: 'ana@weatherford.com', linkedinUrl: null }));
    await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin', allowApproved: true }, d);
    const block = (persisted[0].enrichment_metadata as Record<string, Record<string, unknown>>).identity_completion;
    assert.equal(block.input_key, identityCompletionInputKey({ email: 'ana@weatherford.com', linkedinUrl: null }));
  });
});

// ── «Verificar correo» ──────────────────────────────────────────────

describe('«Verificar correo»', () => {
  it('pregunta por LinkedIn SIN la empresa vieja, clasifica y no escribe el correo', async () => {
    const apollo: IdentityLookup = {
      kind: 'found',
      person: { id: '5f8d0d55b54764421b7156c5', firstName: 'Ana', lastName: 'Márquez', linkedinUrl: null, email: 'ana@nueva.com', currentEmployment: snapshotAt('Nueva SA', 'nueva.com') },
      usage: USAGE,
    };
    const { d, persisted, apolloQueries, lushaQueries } = deps(apollo, candidate({ email: 'ana@weatherford.com' }), { kind: 'not_found', usage: [] });
    const result = await runCandidateEmailVerification({ candidateId: 'cand-1', allowApproved: true, companyDomains: ['weatherford.com'] }, d);
    assert.equal(result.status, 'checked');
    assert.equal(result.check?.case, 'company_change');
    assert.equal(apolloQueries[0].channel, 'linkedin');
    assert.equal(apolloQueries[0].organizationName, null);
    assert.equal(apolloQueries[0].domain, null);
    assert.equal(apolloQueries[0].wantsEmail, true);
    // Apollo ya trajo correo: Lusha no se llama.
    assert.equal(lushaQueries.length, 0);
    assert.equal(persisted[0].email, undefined);
    assert.equal(persisted[0].apollo_person_id, '5f8d0d55b54764421b7156c5');
    // Verificar no toca el bloque de «revelar».
    assert.equal((persisted[0].enrichment_metadata as Record<string, unknown>).identity_completion, undefined);
  });

  it('Apollo sin correo → Lusha; sin nadie que lo encuentre: G guardado', async () => {
    const apollo: IdentityLookup = {
      kind: 'found',
      person: { id: 'ap-1', firstName: 'Ana', lastName: 'Márquez', linkedinUrl: null, email: null, currentEmployment: snapshotAt('Weatherford', 'weatherford.com') },
      usage: USAGE,
    };
    const { d, lushaQueries, persisted } = deps(apollo, candidate({ email: 'ana@weatherford.com' }), { kind: 'not_found', usage: [] });
    const result = await runCandidateEmailVerification({ candidateId: 'cand-1', allowApproved: true }, d);
    assert.equal(lushaQueries.length, 1);
    assert.equal(result.check?.case, 'no_new_email');
    assert.equal(readEmailCheckBlock(persisted[0].enrichment_metadata)?.case, 'no_new_email');
  });

  it('sin LinkedIn no se gasta', async () => {
    const { d, apolloQueries } = deps({ kind: 'not_found', usage: [] }, candidate({ linkedinUrl: null }));
    const result = await runCandidateEmailVerification({ candidateId: 'cand-1', allowApproved: true }, d);
    assert.equal(result.status, 'missing_linkedin');
    assert.equal(apolloQueries.length, 0);
  });

  it('un aprobado sólo si el servidor lo pide; un rol sin permiso no gasta', async () => {
    const one = deps({ kind: 'not_found', usage: [] }, candidate());
    assert.equal((await runCandidateEmailVerification({ candidateId: 'cand-1' }, one.d)).status, 'not_reviewable');
    const two = deps({ kind: 'not_found', usage: [] }, candidate());
    two.d.actor = { internalUserId: 'u', roleKey: 'viewer' };
    assert.equal((await runCandidateEmailVerification({ candidateId: 'cand-1', allowApproved: true }, two.d)).status, 'unauthorized_role');
  });
});

// ── HubSpot: correos y empresa principal ────────────────────────────

function emailDeps(initial: { primary: string | null; additional: string[] }, opts: { setStatus?: number; addFails?: boolean; keepsPrevious?: boolean } = {}) {
  const state = { primary: initial.primary, additional: [...initial.additional] };
  const calls: string[] = [];
  const d: HubSpotEmailDeps = {
    readEmails: async () => ({ primary: state.primary, additional: [...state.additional] }),
    setPrimaryEmail: async (_id, email) => {
      calls.push(`set:${email}`);
      if (opts.setStatus) return { error: `HUBSPOT_EMAIL_HTTP_${opts.setStatus}`, status: opts.setStatus };
      if (opts.keepsPrevious && state.primary) state.additional.push(state.primary);
      state.primary = email;
      return { ok: true };
    },
    addSecondaryEmail: async (_id, email) => {
      calls.push(`add:${email}`);
      if (opts.addFails) return { error: 'HUBSPOT_SECONDARY_EMAIL_HTTP_400' };
      state.additional.push(email);
      return { ok: true };
    },
  };
  return { d, state, calls };
}

describe('HubSpot: correo principal y adicionales', () => {
  it('el nuevo pasa a principal y el anterior queda como adicional', async () => {
    const { d, state, calls } = emailDeps({ primary: 'ana@weatherford.com', additional: [] });
    assert.equal(await makeHubSpotPrimaryEmail('501', 'ana.m@weatherford.com', d), 'promoted');
    assert.equal(state.primary, 'ana.m@weatherford.com');
    assert.deepEqual(state.additional, ['ana@weatherford.com']);
    assert.deepEqual(calls, ['set:ana.m@weatherford.com', 'add:ana@weatherford.com']);
  });

  it('si HubSpot ya guardó el anterior como adicional, no se vuelve a agregar', async () => {
    const { d, calls } = emailDeps({ primary: 'ana@weatherford.com', additional: [] }, { keepsPrevious: true });
    assert.equal(await makeHubSpotPrimaryEmail('501', 'ana.m@weatherford.com', d), 'promoted');
    assert.deepEqual(calls, ['set:ana.m@weatherford.com']);
  });

  it('409 = otro contacto lo usa: no se cambia nada', async () => {
    const { d, state } = emailDeps({ primary: 'ana@weatherford.com', additional: [] }, { setStatus: 409 });
    assert.equal(await makeHubSpotPrimaryEmail('501', 'ana@nueva.com', d), 'conflict');
    assert.equal(state.primary, 'ana@weatherford.com');
  });

  it('ya era el principal / no se pudo leer / el anterior no se pudo guardar', async () => {
    assert.equal(await makeHubSpotPrimaryEmail('501', 'ANA@weatherford.com', emailDeps({ primary: 'ana@weatherford.com', additional: [] }).d), 'already_primary');
    const unreadable: HubSpotEmailDeps = { ...emailDeps({ primary: null, additional: [] }).d, readEmails: async () => null };
    assert.equal(await makeHubSpotPrimaryEmail('501', 'x@y.com', unreadable), 'unreadable');
    assert.equal(await makeHubSpotPrimaryEmail('501', 'n@w.com', emailDeps({ primary: 'o@w.com', additional: [] }, { addFails: true }).d), 'promoted_previous_not_kept');
  });

  it('correo personal: sólo adicional, nunca principal', async () => {
    const { d, state, calls } = emailDeps({ primary: 'ana@weatherford.com', additional: [] });
    assert.equal(await addHubSpotAdditionalEmail('501', 'ana@gmail.com', d), 'added_as_additional');
    assert.equal(state.primary, 'ana@weatherford.com');
    assert.ok(!calls.some((c) => c.startsWith('set:')));
    assert.equal(await addHubSpotAdditionalEmail('501', 'ana@gmail.com', d), 'already_additional');
  });
});

describe('HubSpot: al aprobar, la empresa nueva queda como principal y las demás se desasocian', () => {
  it('primero asocia la nueva, después quita las otras', async () => {
    const calls: string[] = [];
    const report = await moveHubSpotContactToCompany('501', 'c-new', {
      setPrimaryCompany: async (_c, id) => {
        calls.push(`primary:${id}`);
        return { ok: true };
      },
      listCompanyIds: async () => ['c-old', 'c-new', 'c-other'],
      removeCompany: async (_c, id) => {
        calls.push(`remove:${id}`);
        return { ok: true };
      },
    });
    assert.equal(report.outcome, 'moved');
    assert.deepEqual(calls, ['primary:c-new', 'remove:c-old', 'remove:c-other']);
  });

  it('si no se puede asociar la nueva, no se quita ninguna', async () => {
    const calls: string[] = [];
    const report = await moveHubSpotContactToCompany('501', 'c-new', {
      setPrimaryCompany: async () => ({ error: 'HUBSPOT_PRIMARY_ASSOC_HTTP_403' }),
      listCompanyIds: async () => ['c-old'],
      removeCompany: async (_c, id) => {
        calls.push(id);
        return { ok: true };
      },
    });
    assert.equal(report.outcome, 'failed');
    assert.deepEqual(calls, []);
  });

  it('plan: todas menos la destino', () => {
    assert.deepEqual(planHubSpotCompanyReassociation(['a', 'b', 'a', 'c'], 'b'), ['a', 'c']);
  });
});

// ── Cambio de empresa ───────────────────────────────────────────────

function contact(overrides: Partial<CompanyChangeContact> = {}): CompanyChangeContact {
  return {
    id: 'contact-1',
    accountId: 'acc-old',
    accountName: 'Weatherford',
    accountDomain: 'weatherford.com',
    accountHubSpotCompanyId: 'hs-company-old',
    firstName: 'Ana',
    lastName: 'Márquez',
    fullName: 'Ana Márquez',
    email: 'ana@weatherford.com',
    linkedinUrl: 'https://www.linkedin.com/in/ana-marquez',
    jobTitle: 'Gerente RH',
    seniority: null,
    hubspotContactId: '501',
    contactStatus: 'active',
    archivedAt: null,
    metadata: { source_candidate_id: '11111111-1111-4111-8111-111111111111', hubspot_sync: { status: 'synced' } },
    ...overrides,
  };
}

function check(overrides: Partial<EmailCheckBlock> = {}): EmailCheckBlock {
  return {
    hito: 'AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE',
    case: 'company_change',
    purpose: 'verify_email',
    checked_at: NOW,
    checked_by: 'u-1',
    provider: 'apollo',
    found_email: 'ana@nueva.com',
    found_email_domain: 'nueva.com',
    employment: { status: 'other_company', current_company: 'Nueva SA', current_title: 'Directora de Talento', current_since: '2026-03-01', organization_domain: 'nueva.com' },
    resolution: null,
    resolved_at: null,
    resolved_by: null,
    new_candidate_id: null,
    ...overrides,
  };
}

describe('«Cambió de empresa»', () => {
  it('sólo con un cambio pendiente, contacto vivo y LinkedIn', () => {
    assert.deepEqual(evaluateCompanyChangeConfirmation({ contact: contact(), check: check() }), { ok: true });
    assert.equal((evaluateCompanyChangeConfirmation({ contact: contact(), check: check({ case: 'same_email' }) }) as { reason: string }).reason, 'no_pending_change');
    assert.equal(
      (evaluateCompanyChangeConfirmation({ contact: contact(), check: check({ resolution: 'company_change_confirmed' }) }) as { reason: string }).reason,
      'already_confirmed',
    );
    assert.equal((evaluateCompanyChangeConfirmation({ contact: contact({ archivedAt: NOW }), check: check() }) as { reason: string }).reason, 'contact_unavailable');
    assert.equal((evaluateCompanyChangeConfirmation({ contact: contact({ linkedinUrl: null }), check: check() }) as { reason: string }).reason, 'missing_linkedin');
  });

  it('el candidato nuevo: mismo contacto de HubSpot, sin la empresa vieja ni los teléfonos viejos', () => {
    const hubspotId = resolveCompanyChangeHubSpotContactId(contact(), null);
    const data = buildCompanyChangeSearchData({ contact: contact(), candidate: null, check: check(), hubspotContactId: hubspotId, nowIso: NOW });
    assert.equal(data.entryMode, 'company_change');
    assert.equal(data.profile.provider, 'hubspot');
    assert.equal(data.profile.sourceContactId, '501');
    assert.equal(data.profile.email, 'ana@nueva.com');
    assert.equal(data.profile.title, 'Directora de Talento');
    assert.equal(data.profile.providerCompanyName, 'Nueva SA');
    assert.equal(data.profile.phone, null);
    assert.deepEqual(data.hubspotContact, { id: '501', associatedCompanyId: null });
    const row = buildQuickSearchCandidateRow({ runId: 'run-1', data, company: null, consistency: null, companyMatchedBy: null });
    assert.equal(row.phone, null);
    assert.equal(row.matched_hubspot_contact_id, '501');
    assert.equal(row.status, 'pending_review');
  });

  it('sin HubSpot: candidato de origen Apollo (se crea en HubSpot al aprobar)', () => {
    const data = buildCompanyChangeSearchData({
      contact: contact({ hubspotContactId: null }),
      candidate: { id: 'c', source: 'manual', sourceContactId: null, matchedHubSpotContactId: null, apolloPersonId: 'ap-1', linkedinUrl: null },
      check: check(),
      hubspotContactId: null,
      nowIso: NOW,
    });
    assert.equal(data.profile.provider, 'apollo');
    assert.equal(data.profile.sourceContactId, 'ap-1');
    assert.equal(data.hubspotContact, null);
  });

  it('la empresa resuelta es la misma: no es un cambio', () => {
    assert.ok(isCurrentCompany({ source: 'sellup', sellupAccountId: 'acc-old', name: 'W', matchConfidence: 1 }, contact()));
    assert.ok(isCurrentCompany({ source: 'hubspot', hubspotCompanyId: 'hs-company-old', name: 'W', matchConfidence: 1 }, contact()));
    assert.ok(!isCurrentCompany({ source: 'hubspot', hubspotCompanyId: 'hs-new', name: 'N', matchConfidence: 1 }, contact()));
  });

  it('a HubSpot antes de la revisión: correo nuevo y cargo actual', () => {
    assert.deepEqual(planCompanyChangeHubSpotPush({ contact: contact(), check: check() }), { email: 'ana@nueva.com', jobTitle: 'Directora de Talento' });
    assert.deepEqual(planCompanyChangeHubSpotPush({ contact: contact(), check: check({ found_email: null, case: 'left_no_email' }) }).email, null);
  });

  it('archivar con la información de hoy y desarchivar tal cual', () => {
    const block = buildContactCompanyChangeBlock({
      contact: contact(),
      check: check(),
      actorId: 'u-1',
      nowIso: NOW,
      newCandidateId: 'cand-new',
      newCompanyName: 'Nueva SA',
      newAccountId: null,
      hubspotContactId: '501',
      hubspotPush: { email: 'promoted', job_title: 'written' },
    });
    const archived = buildCompanyChangeArchivePatch({ contact: contact(), block, actorId: 'u-1', nowIso: NOW });
    assert.equal(archived.contact_status, 'archived');
    assert.equal(archived.archived_at, NOW);
    // Lo que tenía se conserva.
    assert.deepEqual((archived.metadata as Record<string, unknown>).hubspot_sync, { status: 'synced' });
    const stored = readContactCompanyChange(archived.metadata);
    assert.equal(stored?.new_candidate_id, 'cand-new');
    assert.equal(stored?.outcome, 'pending_review');

    const archivedContact = contact({ archivedAt: NOW, metadata: archived.metadata });
    const gate = evaluateCompanyChangeRestore(archivedContact);
    assert.ok(gate.ok);
    const restored = buildCompanyChangeRestorePatch({ contact: archivedContact, block: stored!, actorId: 'u-2', nowIso: NOW });
    assert.equal(restored.archived_at, null);
    assert.equal(restored.contact_status, 'active');
    assert.equal(readContactCompanyChange(restored.metadata)?.restored_by, 'u-2');

    assert.equal((evaluateCompanyChangeRestore(contact({ archivedAt: NOW, metadata: {} })) as { reason: string }).reason, 'not_company_change');
    assert.equal((evaluateCompanyChangeRestore(contact()) as { reason: string }).reason, 'not_archived');

    const approved = readContactCompanyChange(withCompanyChangeOutcome(archived.metadata, stored!, { outcome: 'approved', nowIso: NOW, approvedContactId: 'c-new', hubspotReassociation: 'moved' }));
    assert.equal(approved?.outcome, 'approved');
    assert.equal(approved?.approved_contact_id, 'c-new');
    assert.equal(approved?.hubspot_reassociation, 'moved');
  });
});

// ── Ficha del contacto ──────────────────────────────────────────────

describe('ficha del contacto oficial', () => {
  const candidateRow = {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'approved',
    source: 'apollo',
    sourceContactId: 'ap-1',
    matchedContactsId: 'contact-1',
    apolloPersonId: 'ap-1',
    email: null,
    linkedinUrl: null,
    enrichmentMetadata: {},
  };
  const contactRow = {
    id: 'contact-1',
    archivedAt: null,
    email: 'ana@weatherford.com',
    linkedinUrl: 'https://www.linkedin.com/in/ana-marquez',
    metadata: { source_candidate_id: '11111111-1111-4111-8111-111111111111' },
  };

  it('«Verificar correo» con correo y LinkedIn (del contacto), de cualquier origen', () => {
    const offer = classifyOfficialContactChannelOffer({ contact: contactRow, candidate: candidateRow, roleAuthorized: true });
    assert.equal(offer.reason, 'ok');
    assert.equal(offer.verifyEmail, true);
    assert.equal(offer.email, false);
    assert.equal(offer.linkedin, false);
  });

  it('sin rol: nada', () => {
    const offer = classifyOfficialContactChannelOffer({ contact: contactRow, candidate: candidateRow, roleAuthorized: false });
    assert.equal(offer.verifyEmail, false);
  });

  it('el candidato de origen de un contacto creado a mano: aprobado, apuntando a él, sin teléfono', () => {
    const row = buildOfficialContactSourceCandidateRow(
      {
        id: 'contact-1',
        accountId: 'acc-1',
        accountName: 'Weatherford',
        accountDomain: 'weatherford.com',
        accountCountryCode: 'MX',
        accountHubSpotCompanyId: null,
        firstName: 'Ana',
        lastName: 'Márquez',
        fullName: 'Ana Márquez',
        email: 'Ana@Weatherford.com',
        linkedinUrl: null,
        jobTitle: null,
        hubspotContactId: null,
      },
      'run-1',
      'u-1',
      NOW,
    );
    assert.equal(row.status, 'approved');
    assert.equal(row.matched_contacts_id, 'contact-1');
    assert.equal(row.source, 'manual');
    assert.equal(row.phone, null);
    assert.equal(row.email, 'ana@weatherford.com');
  });

  it('las corridas internas no salen en el historial', () => {
    assert.ok(isHubSpotLookupImportRunSummary({ entry_mode: 'official_contact_source' }));
    assert.ok(isHubSpotLookupImportRunSummary({ entry_mode: 'company_change' }));
    assert.ok(isHubSpotLookupImportRunSummary({ entry_mode: 'hubspot_lookup_import' }));
    assert.ok(!isHubSpotLookupImportRunSummary({ entry_mode: 'linkedin_single' }));
  });

  it('vista: empleo y cambio pendiente desde el candidato de origen', () => {
    const state = buildOfficialContactEmailState({ email_check: check() as unknown as Record<string, unknown> });
    assert.equal(state.pendingCompanyChange, true);
    assert.equal(state.newCompanyName, 'Nueva SA');
    assert.match(employmentLine(state.employment) ?? '', /Ahora trabaja en Nueva SA desde 2026-03-01/);
  });
});

// ── Guardas estáticas ───────────────────────────────────────────────

describe('guardas estáticas', () => {
  it('las acciones nuevas resuelven el actor, el alcance del contacto y el rol', () => {
    for (const file of [`${CE}/contact-company-change-actions.ts`, `${CE}/official-contact-identity-completion-actions.ts`]) {
      const src = code(file);
      assert.match(src, /^'use server'/m, file);
      assert.match(src, /requireActiveActor\(/, file);
      assert.match(src, /canSeeOfficialContact\(/, file);
      assert.doesNotMatch(src, /from\('roles'\)/, file);
    }
    assert.match(code(`${CE}/contact-company-change-actions.ts`), /isPhoneRevealRoleAuthorized\(roleKey\)/);
  });

  it('los ayudantes de servidor NO son acciones invocables', () => {
    for (const file of [`${CE}/contact-company-change.server.ts`, `${CE}/official-contact-email-check.server.ts`, `${CE}/official-contact-identity-completion.server.ts`]) {
      assert.doesNotMatch(code(file), /^'use server'/m, file);
    }
  });

  it('el archivo por cambio de empresa: sólo en su acción y después de crear el candidato', () => {
    const src = code(`${CE}/contact-company-change-actions.ts`);
    const create = src.indexOf('createCompanyChangeCandidate(');
    const archive = src.indexOf('buildCompanyChangeArchivePatch(');
    assert.ok(create > 0 && archive > create);
    assert.match(src, /if \(!created\.ok\)/);
  });

  it('aprobar y rechazar avisan al flujo de cambio de empresa', () => {
    const actions = code(`${CE}/actions.ts`);
    const sync = actions.indexOf('await triggerContactHubSpotSync(result.contactId, internalUserId)');
    const move = actions.indexOf('await afterCompanyChangeCandidateApproved(candidateId, result.contactId)');
    assert.ok(sync > 0 && move > sync);
    assert.match(actions, /if \(result\.ok\) await afterCompanyChangeCandidateDiscarded\(candidateId\)/);
  });

  it('HubSpot: correos adicionales por la API v1 y la empresa principal por v4 (tipo 1)', () => {
    const src = code('src/server/integrations/hubspot-contact-sync.ts');
    assert.match(src, /contacts\/v1\/secondary-email\//);
    assert.match(src, /associationTypeId: HUBSPOT_PRIMARY_CONTACT_TO_COMPANY_TYPE_ID/);
    assert.match(src, /HUBSPOT_PRIMARY_CONTACT_TO_COMPANY_TYPE_ID = 1/);
  });
});

/**
 * AGENT2A-CONTACT-APPROVED-REVIEW (Bryan 19-11) — «Revisión» de un contacto aprobado.
 *
 *  - qué cambia al «Guardar» (correo principal / personal / de otra empresa, LinkedIn, cargo);
 *  - la empresa elegida a mano: del mismo dueño ⇒ en el mismo contacto; de otro dueño, sin dueño o
 *    sin cuenta ⇒ «Cambió de empresa» (opción A), y el candidato sin dueño queda abierto a todos;
 *  - el rastro en el contacto;
 *  - guardas: el permiso de tratar un candidato aprobado como revisable lo decide el servidor, el
 *    runner del cambio de empresa no es una acción y la ficha cambia «Aprobar» por «Guardar».
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  OFFICIAL_CONTACT_REVIEW_TRAIL_KEY,
  appendReviewTrail,
  decideReviewCompanyMove,
  describeOfficialContactReviewChanges,
  isOpenCompanyChangeCandidate,
  isOpenCompanyChangeTarget,
  planOfficialContactReviewChanges,
  reviewPlanHasChanges,
  type ReviewTrailEntry,
} from '../official-contact-review-core';
import {
  buildCompanyChangeSearchData,
  buildManualCompanyChangeCheck,
  type CompanyChangeContact,
} from '../contact-company-change-core';
import { hasPendingCompanyChange } from '../email-change-classifier-core';

const root = process.cwd();
const code = (rel: string) =>
  readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const CE = 'src/modules/contact-enrichment';
const NOW = '2026-11-19T20:00:00.000Z';

const contact = { email: 'laura@abcdin.cl', linkedinUrl: null, jobTitle: 'Jefa de RRHH', accountDomain: 'abcdin.cl' };

describe('«Guardar»: qué cambia', () => {
  it('sin correo en el contacto: se completa (o va aparte si es personal)', () => {
    const fill = planOfficialContactReviewChanges({
      contact: { ...contact, email: null },
      candidate: { email: 'Laura@ABCDIN.cl', linkedinUrl: null, title: null },
    });
    assert.deepEqual(fill.email, { kind: 'fill', email: 'laura@abcdin.cl' });
    const personal = planOfficialContactReviewChanges({
      contact: { ...contact, email: null },
      candidate: { email: 'laura@gmail.com', linkedinUrl: null, title: null },
    });
    assert.equal(personal.email?.kind, 'personal');
  });

  it('otro correo de la misma empresa: pasa a principal; el mismo: nada', () => {
    const plan = planOfficialContactReviewChanges({
      contact,
      candidate: { email: 'ljauregui@abcdin.cl', linkedinUrl: null, title: null },
    });
    assert.deepEqual(plan.email, { kind: 'same_company', email: 'ljauregui@abcdin.cl', previous: 'laura@abcdin.cl' });
    const same = planOfficialContactReviewChanges({ contact, candidate: { email: 'LAURA@abcdin.cl', linkedinUrl: null, title: null } });
    assert.equal(same.email, null);
    assert.equal(reviewPlanHasChanges(same), false);
  });

  it('un correo de OTRA empresa nunca se aplica aquí (va por «Cambió de empresa»)', () => {
    const plan = planOfficialContactReviewChanges({ contact, candidate: { email: 'laura@falabella.cl', linkedinUrl: null, title: null } });
    assert.deepEqual(plan.email, { kind: 'other_company', email: 'laura@falabella.cl' });
    assert.equal(reviewPlanHasChanges(plan), false);
    const lines = describeOfficialContactReviewChanges({ plan, newPhones: [], contactEmail: contact.email, contactJobTitle: contact.jobTitle });
    assert.match(lines[0], /no se cambia aquí/);
  });

  it('LinkedIn sólo si el contacto no tiene; cargo si cambió', () => {
    const plan = planOfficialContactReviewChanges({
      contact,
      candidate: { email: null, linkedinUrl: 'https://www.linkedin.com/in/laura-jauregui', title: 'Gerente de Personas' },
    });
    assert.equal(plan.linkedinUrl, 'https://www.linkedin.com/in/laura-jauregui');
    assert.equal(plan.jobTitle, 'Gerente de Personas');
    const kept = planOfficialContactReviewChanges({
      contact: { ...contact, linkedinUrl: 'https://www.linkedin.com/in/otra' },
      candidate: { email: null, linkedinUrl: 'https://www.linkedin.com/in/laura-jauregui', title: 'jefa de rrhh' },
    });
    assert.equal(kept.linkedinUrl, null);
    assert.equal(kept.jobTitle, null);
  });

  it('el resumen dice cada cosa antes de aplicar', () => {
    const plan = planOfficialContactReviewChanges({
      contact,
      candidate: { email: 'ljauregui@abcdin.cl', linkedinUrl: 'https://www.linkedin.com/in/laura-jauregui', title: 'Gerente de Personas' },
    });
    const lines = describeOfficialContactReviewChanges({
      plan,
      newPhones: ['+56 9 1111 2222', '+56 2 3333 4444'],
      contactEmail: contact.email,
      contactJobTitle: contact.jobTitle,
    });
    assert.deepEqual(lines, [
      'Correo: laura@abcdin.cl → ljauregui@abcdin.cl (el anterior queda como adicional).',
      'Teléfonos nuevos: +56 9 1111 2222, +56 2 3333 4444.',
      'LinkedIn: agregado.',
      'Cargo: Jefa de RRHH → Gerente de Personas.',
    ]);
  });
});

describe('empresa elegida a mano (§ 6)', () => {
  it('del mismo dueño ⇒ en el mismo contacto; otro dueño, sin dueño o sin cuenta ⇒ opción A', () => {
    const base = { actorId: 'u-1', contactAccountId: 'acc-old' };
    assert.equal(decideReviewCompanyMove({ ...base, target: { accountId: 'acc-old', ownerId: 'u-2' } }), 'same_company');
    assert.equal(decideReviewCompanyMove({ ...base, target: { accountId: 'acc-new', ownerId: 'u-1' } }), 'in_place');
    assert.equal(decideReviewCompanyMove({ ...base, target: { accountId: 'acc-new', ownerId: 'u-2' } }), 'company_change');
    assert.equal(decideReviewCompanyMove({ ...base, target: { accountId: 'acc-new', ownerId: null } }), 'company_change');
    assert.equal(decideReviewCompanyMove({ ...base, target: null }), 'company_change');
  });

  it('sin dueño o sin cuenta: el candidato nuevo queda abierto a todos', () => {
    assert.equal(isOpenCompanyChangeTarget(null), true);
    assert.equal(isOpenCompanyChangeTarget({ accountId: 'acc', ownerId: null }), true);
    assert.equal(isOpenCompanyChangeTarget({ accountId: null, ownerId: 'u-1' }), true);
    assert.equal(isOpenCompanyChangeTarget({ accountId: 'acc', ownerId: 'u-1' }), false);
    assert.equal(isOpenCompanyChangeCandidate({ company_change_open: true }), true);
    assert.equal(isOpenCompanyChangeCandidate({ company_change_open: 'true' }), false);
  });

  it('sin detección de un proveedor, el candidato nuevo lleva el correo de hoy y la empresa elegida', () => {
    const old: CompanyChangeContact = {
      id: 'contact-1',
      accountId: 'acc-old',
      accountName: 'ABCDIN',
      accountDomain: 'abcdin.cl',
      accountHubSpotCompanyId: 'hs-old',
      firstName: 'Laura',
      lastName: 'Jauregui',
      fullName: 'Laura Jauregui',
      email: 'Laura@abcdin.cl',
      linkedinUrl: 'https://www.linkedin.com/in/laura-jauregui',
      jobTitle: 'Jefa de RRHH',
      seniority: null,
      hubspotContactId: '901',
      contactStatus: 'active',
      archivedAt: null,
      metadata: {},
    };
    const check = buildManualCompanyChangeCheck({ contact: old, company: { name: 'Empresa Y', domain: 'empresay.cl' }, actorId: 'u-1', nowIso: NOW });
    assert.equal(hasPendingCompanyChange(check), true);
    assert.equal(check.found_email, 'laura@abcdin.cl');
    const data = buildCompanyChangeSearchData({ contact: old, candidate: null, check, hubspotContactId: '901', nowIso: NOW, phones: [{ number: '+56 9 1', origin: 'mobile' }] });
    assert.equal(data.profile.email, 'laura@abcdin.cl');
    assert.equal(data.profile.providerCompanyName, 'Empresa Y');
    assert.equal(data.profile.title, 'Jefa de RRHH');
    assert.equal(data.profile.phone, '+56 9 1');
    assert.deepEqual(data.hubspotContact, { id: '901', associatedCompanyId: null });
  });
});

describe('rastro en el contacto', () => {
  it('se agrega al final, sin pisar la metadata, con tope', () => {
    const entry = (n: number): ReviewTrailEntry => ({
      hito: 'AGENT2A-CONTACT-APPROVED-REVIEW',
      candidate_id: 'c-1',
      saved_at: NOW,
      saved_by: 'u-1',
      trigger: 'save',
      changes: [`cambio ${n}`],
      failed: [],
    });
    let metadata: Record<string, unknown> = { hubspot_sync: { status: 'synced' } };
    for (let i = 0; i < 25; i++) metadata = appendReviewTrail(metadata, entry(i));
    const trail = metadata[OFFICIAL_CONTACT_REVIEW_TRAIL_KEY] as ReviewTrailEntry[];
    assert.equal(trail.length, 20);
    assert.deepEqual(trail.at(-1)?.changes, ['cambio 24']);
    assert.deepEqual(metadata.hubspot_sync, { status: 'synced' });
  });
});

describe('guardas', () => {
  const ACTIONS = code(`${CE}/official-contact-review-actions.ts`);
  const SERVER = code(`${CE}/official-contact-review.server.ts`);
  const IDENTITY = code(`${CE}/candidate-identity-completion-actions.ts`);
  const RUNNER = readFileSync(path.join(root, `${CE}/contact-company-change-runner.server.ts`), 'utf8');
  const CHANGE_ACTIONS = code(`${CE}/contact-company-change-actions.ts`);
  const SHEET = code('src/components/contact-enrichment/contact-candidate-detail-sheet.tsx');
  const CHANNELS = code('src/components/contacts/contact-channels-section.tsx');
  const SCOPE = code(`${CE}/candidate-scope.server.ts`);
  const LISTS = code(`${CE}/actions.ts`);

  it('aprobado-como-revisable lo decide el servidor, nunca el navegador', () => {
    assert.match(SERVER, /status !== 'approved'/);
    assert.match(SERVER, /durable\.candidateId !== id/);
    assert.match(SERVER, /canSeeOfficialContact\(/);
    assert.doesNotMatch(IDENTITY, /input\??\.allowApproved/);
    assert.match(IDENTITY, /resolveApprovedReviewAllowance\(candidateId\)/);
  });

  it('el runner del cambio de empresa NO es una acción; las acciones validan antes de llamarlo', () => {
    assert.doesNotMatch(RUNNER.split('\n').slice(0, 3).join('\n'), /'use server'/);
    assert.doesNotMatch(CHANGE_ACTIONS, /export async function run/);
    const roleCheck = ACTIONS.indexOf("if (decision === 'company_change')");
    const gate = ACTIONS.indexOf('isPhoneRevealRoleAuthorized(roleKey)', roleCheck);
    const run = ACTIONS.indexOf('runManualCompanyChangeForContact(', roleCheck);
    assert.ok(roleCheck > 0 && gate > roleCheck && run > gate);
  });

  it('«Guardar» no reutiliza la aprobación (RPC 116) y valida el vínculo durable', () => {
    assert.doesNotMatch(ACTIONS, /approve_contact_candidate_with_phones|approveContactCandidate\(/);
    assert.match(ACTIONS, /resolveOfficialContactSourceCandidateId\(c\.metadata\)/);
    assert.match(ACTIONS, /k\.status !== 'approved' \|\| k\.matched_contacts_id !== contactId/);
  });

  it('la ficha del candidato: «Guardar» en vez de «Aprobar», sin el paso de aprobación, y guarda al cerrar', () => {
    assert.match(SHEET, /<ContactReviewSaveActions/);
    assert.match(SHEET, /isContactReview \? null : <CandidateReviewStep/);
    assert.match(SHEET, /saveContactReviewOnClose\(reviewContactId, candidateId\)/);
    assert.match(SHEET, /isContactReview && candidate\.status === 'approved'/);
  });

  it('el botón «Revisión» vive en la pieza compartida (panel y página)', () => {
    assert.match(CHANNELS, /openOfficialContactReviewAction\(/);
    assert.match(CHANNELS, /variant="contact_review"/);
    assert.match(CHANNELS, /React\.lazy\(/);
  });

  it('el aviso de «ya tiene teléfono» apunta a «Revisión»', () => {
    const copy = code('src/components/contacts/post-approval-reveal-copy.ts');
    assert.match(copy, /usa «Revisión»/);
    assert.doesNotMatch(copy, /usa la revisión del candidato/);
  });

  it('el candidato abierto lo ven todos (por id y en las listas)', () => {
    assert.match(SCOPE, /isOpenCompanyChangeCandidate\(row\.enrichment_metadata\)/);
    assert.match(LISTS, /contains\('enrichment_metadata', \{ \[COMPANY_CHANGE_OPEN_METADATA_KEY\]: true \}\)/);
  });
});

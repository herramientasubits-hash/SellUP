/**
 * AGENT2A-CONTACT-PAGE-ACTIONS (Bryan 19-11).
 *
 *  - la página del contacto y el panel usan la MISMA pieza «Cómo contactarle» (revelar correo /
 *    LinkedIn / teléfono, «Ver más números», «Verificar correo», cambio de empresa, fusión);
 *  - en la página de la empresa, el nombre del contacto abre su panel;
 *  - «Revelar LinkedIn» que detecta un cambio de empresa SIN el correo nuevo ofrece buscarlo por
 *    el LinkedIn antes de mandarlo a revisión;
 *  - en un cambio de empresa viajan TODOS los teléfonos del contacto viejo al candidato nuevo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildCandidateCompanyChangeBlock,
  buildCompanyChangeSearchData,
  collectCompanyChangePhones,
  readCandidateCompanyChange,
  type CompanyChangeContact,
} from '../contact-company-change-core';
import { buildQuickSearchCandidateRow } from '../contact-quick-search-candidate-core';
import {
  buildOfficialContactEmailState,
  companyChangeLacksNewEmail,
  newEmailAlreadySearched,
} from '../official-contact-email-check-view';
import { EMAIL_CHECK_METADATA_KEY, type EmailCheckBlock } from '../email-change-classifier-core';

const NOW = '2026-11-19T15:00:00.000Z';
const root = process.cwd();
const code = (rel: string) =>
  readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function contact(overrides: Partial<CompanyChangeContact> = {}): CompanyChangeContact {
  return {
    id: 'contact-1',
    accountId: 'acc-old',
    accountName: 'Lo Valledor',
    accountDomain: 'lovalledor.cl',
    accountHubSpotCompanyId: 'hs-company-old',
    firstName: 'Daniela',
    lastName: 'Ramírez',
    fullName: 'Daniela Ramírez',
    email: 'dramirez@lovalledor.cl',
    linkedinUrl: 'https://www.linkedin.com/in/daniela-ramirez',
    jobTitle: 'Jefe desarrollo organizacional',
    seniority: null,
    hubspotContactId: '701',
    contactStatus: 'active',
    archivedAt: null,
    metadata: {},
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
    found_email: 'daniela@nueva.cl',
    found_email_domain: 'nueva.cl',
    employment: { status: 'other_company', current_company: 'Nueva SpA', current_title: 'Gerente de Personas', current_since: '2026-06-01', organization_domain: 'nueva.cl' },
    resolution: null,
    resolved_at: null,
    resolved_by: null,
    new_candidate_id: null,
    ...overrides,
  };
}

// ── Teléfonos que viajan ────────────────────────────────────────────

describe('cambio de empresa — todos los teléfonos viajan (Bryan 19-11)', () => {
  it('en orden (celular, teléfono, Apollo / Lusha, guardados) y sin repetir', () => {
    const phones = collectCompanyChangePhones({
      mobilePhone: '+56 9 8803 7304',
      mainPhone: '+56988037304', // el mismo que el celular, escrito distinto
      providerPhone: '+56 2 2345 6789',
      storedPhones: ['+56 2 2345 6789', ' +1 305 555 0100 ', null, '', '123'],
    });
    assert.deepEqual(phones, [
      { number: '+56 9 8803 7304', origin: 'mobile' },
      { number: '+56 2 2345 6789', origin: 'provider' },
      { number: '+1 305 555 0100', origin: 'stored' },
    ]);
    assert.deepEqual(collectCompanyChangePhones({ mobilePhone: null, mainPhone: null, providerPhone: null, storedPhones: [] }), []);
  });

  it('el primero es el teléfono del candidato nuevo, venga de HubSpot o no', () => {
    const phones = collectCompanyChangePhones({ mobilePhone: null, mainPhone: '+56 2 1111 2222', providerPhone: '+56 9 3333 4444', storedPhones: [] });
    for (const hubspotContactId of ['701', null]) {
      const data = buildCompanyChangeSearchData({
        contact: contact({ hubspotContactId }),
        candidate: null,
        check: check(),
        hubspotContactId,
        nowIso: NOW,
        phones,
      });
      assert.equal(data.profile.phone, '+56 2 1111 2222');
      const row = buildQuickSearchCandidateRow({ runId: 'run-1', data, company: null, consistency: null, companyMatchedBy: null });
      assert.equal(row.phone, '+56 2 1111 2222', `con HubSpot=${hubspotContactId}`);
      assert.equal(row.status, 'pending_review');
    }
  });

  it('sin teléfonos en el contacto viejo, el candidato nace sin teléfono', () => {
    const data = buildCompanyChangeSearchData({ contact: contact(), candidate: null, check: check(), hubspotContactId: '701', nowIso: NOW, phones: [] });
    assert.equal(data.profile.phone, null);
  });

  it('regresión: una búsqueda puntual de un proveedor sigue sin escribir teléfono', () => {
    const data = buildCompanyChangeSearchData({ contact: contact({ hubspotContactId: null }), candidate: null, check: check(), hubspotContactId: null, nowIso: NOW, phones: [{ number: '+56 9 1', origin: 'mobile' }] });
    const row = buildQuickSearchCandidateRow({
      runId: 'run-1',
      data: { ...data, entryMode: 'linkedin_single' },
      company: null,
      consistency: null,
      companyMatchedBy: null,
    });
    assert.equal(row.phone, null);
  });

  it('la lista completa queda en el candidato y se relee (los bloques viejos, sin lista)', () => {
    const phones = collectCompanyChangePhones({ mobilePhone: '+56 9 8803 7304', mainPhone: '+56 2 1111 2222', providerPhone: null, storedPhones: [] });
    const block = buildCandidateCompanyChangeBlock({ contact: contact(), check: check(), hubspotContactId: '701', actorId: 'u-1', nowIso: NOW, phones });
    assert.deepEqual(block.previous_phones, phones);
    const read = readCandidateCompanyChange({ company_change: JSON.parse(JSON.stringify(block)) });
    assert.deepEqual(read?.previous_phones, phones);
    const legacy = { ...JSON.parse(JSON.stringify(block)) } as Record<string, unknown>;
    delete legacy.previous_phones;
    assert.deepEqual(readCandidateCompanyChange({ company_change: legacy })?.previous_phones, []);
  });
});

// ── «Revelar LinkedIn» detectó el cambio sin el correo nuevo ─────────

describe('cambio detectado sin el correo nuevo → buscarlo por el LinkedIn', () => {
  const state = (block: EmailCheckBlock) => buildOfficialContactEmailState({ [EMAIL_CHECK_METADATA_KEY]: block });

  it('detectado de paso al revelar el LinkedIn con el correo viejo: falta el nuevo', () => {
    const s = state(check({ case: 'conflicting', purpose: 'linkedin', found_email: 'dramirez@lovalledor.cl', found_email_domain: 'lovalledor.cl' }));
    assert.equal(s.pendingCompanyChange, true);
    assert.equal(companyChangeLacksNewEmail(s, 'DRamirez@lovalledor.cl'), true);
    assert.equal(newEmailAlreadySearched(s), false);
  });

  it('sin correo (ya no trabaja aquí): falta el nuevo', () => {
    const s = state(check({ case: 'left_no_email', purpose: 'linkedin', found_email: null, found_email_domain: null }));
    assert.equal(companyChangeLacksNewEmail(s, 'dramirez@lovalledor.cl'), true);
  });

  it('con un correo de la empresa nueva: no hace falta buscar', () => {
    const s = state(check({ purpose: 'linkedin' }));
    assert.equal(companyChangeLacksNewEmail(s, 'dramirez@lovalledor.cl'), false);
  });

  it('ya buscado con «Verificar correo»: no se vuelve a ofrecer gastar', () => {
    const s = state(check({ case: 'left_no_email', purpose: 'verify_email', found_email: null, found_email_domain: null }));
    assert.equal(companyChangeLacksNewEmail(s, 'dramirez@lovalledor.cl'), true);
    assert.equal(newEmailAlreadySearched(s), true);
  });

  it('sin cambio pendiente no aplica', () => {
    const s = state(check({ resolution: 'dismissed' }));
    assert.equal(companyChangeLacksNewEmail(s, 'dramirez@lovalledor.cl'), false);
  });
});

// ── Cableado ────────────────────────────────────────────────────────

describe('cableado: la página del contacto y la empresa', () => {
  const SHEET = code('src/components/contacts/contact-detail-sheet.tsx');
  const CHANNELS = code('src/components/contacts/contact-channels-section.tsx');
  const PAGE = code('src/app/(sellup)/contacts/[contactId]/page.tsx');
  const PAGE_CHANNELS = code('src/components/contacts/contact-page-channels.tsx');
  const ACCOUNT_PAGE = code('src/app/(sellup)/accounts/[accountId]/page.tsx');
  const ACCOUNT_TAB = code('src/components/contacts/account-contacts-tab-client.tsx');
  const PANEL = code('src/components/contacts/official-contact-email-check-panel.tsx');

  it('el panel y la página montan la MISMA pieza con todas las acciones', () => {
    assert.match(SHEET, /<ContactChannelsSection/);
    assert.match(PAGE, /<ContactPageChannels/);
    assert.match(PAGE_CHANNELS, /<ContactChannelsSection[\s\S]*variant="page"/);
    for (const piece of [
      'OfficialContactChannelRevealControl',
      'OfficialContactPhoneRevealCta',
      'OfficialContactStoredPhonesDisclosure',
      'OfficialContactEmailCheckPanel',
      'OfficialContactHubSpotMergePanel',
    ]) {
      assert.match(CHANNELS, new RegExp(`<${piece}`), piece);
      assert.doesNotMatch(SHEET, new RegExp(`<${piece}`), `${piece} ya no se pinta por separado en el panel`);
    }
    assert.match(PAGE, /<ContactPageCompanyChangeBanner/);
    assert.match(PAGE_CHANNELS, /router\.refresh\(\)/);
  });

  it('la página ya no dice «Teléfono fijo» y el panel enlaza a ella', () => {
    assert.doesNotMatch(PAGE, /Teléfono fijo/);
    assert.doesNotMatch(CHANNELS, /Teléfono fijo/);
    assert.match(SHEET, /href=\{`\/contacts\/\$\{contact\.id\}`\}/);
    assert.match(SHEET, /Abrir página completa/);
  });

  it('en la página de la empresa, el nombre abre el panel del contacto', () => {
    assert.match(ACCOUNT_PAGE, /<AccountContactsTabClient/);
    assert.doesNotMatch(ACCOUNT_PAGE, /<ContactsTab\b/);
    assert.match(ACCOUNT_TAB, /onViewContact=\{view\}/);
    assert.match(ACCOUNT_TAB, /<ContactDetailSheet/);
  });

  it('el aviso de cambio ofrece buscar el correo nuevo con «Verificar correo» (sin acción nueva)', () => {
    assert.match(PANEL, /offerNewEmailSearch/);
    assert.match(PANEL, /COMPANY_CHANGE_SEARCH_EMAIL_LABEL/);
    assert.match(PANEL, /verifyOfficialContactEmailAction\(/);
    assert.match(CHANNELS, /currentEmail=\{contact\.email\}/);
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Bryan 25-11: orden fijo de la pestaña Contactos de la empresa, en el panel y en la página:
// 1) Contactos (aprobados) → 2) tarjetas Total/Decisores/Champions/Inactivos →
// 3) Contactos de otras fuentes → 4) Contactos en HubSpot. Reemplaza la regla anterior
// (Sportium 25-11) que subía HubSpot arriba cuando la empresa no tenía contactos en SellUp.

const page = readFileSync('src/app/(sellup)/accounts/[accountId]/page.tsx', 'utf8');
const pageTab = readFileSync('src/components/contacts/account-contacts-tab-client.tsx', 'utf8');
const sheet = readFileSync('src/components/accounts/account-detail-sheet.tsx', 'utf8');
const tab = readFileSync('src/components/contacts/contacts-tab.tsx', 'utf8');

test('pestaña: la tabla de Contactos va antes de las tarjetas de resumen', () => {
  const table = tab.indexOf('<TableShell');
  const cards = tab.indexOf('title="Total"');
  assert.ok(table > -1 && cards > tab.indexOf('</TableShell>'));
  assert.ok(cards < tab.indexOf('function ContactRow'));
});

test('página: Contactos → otras fuentes → HubSpot, sin condición por cantidad', () => {
  assert.ok(pageTab.indexOf('<ContactsTab') < pageTab.indexOf('<AccountOtherSourcesContacts'));
  const list = page.indexOf('<AccountContactsTabClient');
  const hubspot = page.indexOf('<AccountHubSpotContacts');
  assert.ok(list > -1 && hubspot > list);
  assert.equal(page.split('<AccountHubSpotContacts').length, 2);
  assert.ok(!page.includes('contacts.length === 0 &&'));
  assert.ok(page.includes('hasHubSpotCompany={!!hubspotCompanyId}'));
});

test('panel lateral: mismo orden, HubSpot siempre al final', () => {
  const contacts = sheet.indexOf('<ContactsTab');
  const others = sheet.indexOf('<AccountOtherSourcesContacts');
  const hubspot = sheet.indexOf('{hubspotBlock}');
  assert.ok(contacts > -1 && others > contacts && hubspot > others);
  assert.ok(!sheet.includes('hubspotFirst'));
  assert.ok(sheet.includes('hasHubSpotCompany={!!data.account.hubspot_company_id}'));
});

test('el vacío menciona los contactos de HubSpot cuando hay ficha', () => {
  assert.ok(tab.includes('hasHubSpotCompany ? EMPTY_CONTACTS_WITH_HUBSPOT_DESCRIPTION : EMPTY_CONTACTS_DESCRIPTION'));
  assert.match(tab, /EMPTY_CONTACTS_WITH_HUBSPOT_DESCRIPTION =\s*'[^']*Contactos en HubSpot[^']*Traer/);
});

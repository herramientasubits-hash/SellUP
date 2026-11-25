import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Sportium 25-11: «Sin contactos todavía» tapaba que la empresa SÍ tenía contactos en
// HubSpot (la sección quedaba debajo y en pantalla chica no se veía).

const page = readFileSync('src/app/(sellup)/accounts/[accountId]/page.tsx', 'utf8');
const sheet = readFileSync('src/components/accounts/account-detail-sheet.tsx', 'utf8');
const tab = readFileSync('src/components/contacts/contacts-tab.tsx', 'utf8');

test('página: sin contactos en SellUp, «Contactos en HubSpot» va antes de la lista', () => {
  const hubspotFirst = page.indexOf('hubspotCompanyId && contacts.length === 0');
  const list = page.indexOf('<AccountContactsTabClient');
  const hubspotAfter = page.indexOf('hubspotCompanyId && contacts.length > 0');
  assert.ok(hubspotFirst > -1 && list > hubspotFirst && hubspotAfter > list);
  assert.ok(page.includes('hasHubSpotCompany={!!hubspotCompanyId}'));
});

test('panel lateral: mismo orden', () => {
  assert.ok(sheet.includes('const hubspotFirst = data.contacts.length === 0;'));
  assert.ok(sheet.indexOf('{hubspotFirst && hubspotBlock}') < sheet.indexOf('{!hubspotFirst && hubspotBlock}'));
  assert.ok(sheet.includes('hasHubSpotCompany={!!data.account.hubspot_company_id}'));
});

test('el vacío menciona los contactos de HubSpot cuando hay ficha', () => {
  assert.ok(tab.includes('hasHubSpotCompany ? EMPTY_CONTACTS_WITH_HUBSPOT_DESCRIPTION : EMPTY_CONTACTS_DESCRIPTION'));
  assert.match(tab, /EMPTY_CONTACTS_WITH_HUBSPOT_DESCRIPTION =\s*'[^']*Contactos en HubSpot[^']*Traer/);
});

/**
 * Tests — Existing Contacts Reader (Agente 2A, Hito 17A.2A)
 *
 * Verifica la lectura de contactos existentes y la deduplicación
 * sin Supabase real ni HubSpot real. Usa inyección de dependencias.
 *
 * Node.js built-in test runner. Sin I/O externo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readExistingContactsForCompany } from '../existing-contacts-reader';
import type {
  ExistingContactsSourceResult,
  ExistingContactSnapshot,
} from '@/modules/contact-enrichment/types';

// ── Fixtures ──────────────────────────────────────────────────

function makeContact(
  overrides: Partial<ExistingContactSnapshot> = {}
): ExistingContactSnapshot {
  return {
    source: 'sellup',
    fullName: 'Juan Pérez',
    email: 'juan@example.com',
    phone: '+57300000001',
    linkedinUrl: 'https://linkedin.com/in/juanperez',
    title: 'Director',
    completeness: { hasEmail: true, hasPhone: true, hasLinkedin: true },
    ...overrides,
  };
}

function successResult(contacts: ExistingContactSnapshot[]): ExistingContactsSourceResult {
  return { status: 'success', contacts, count: contacts.length };
}

function skippedResult(reason: string): ExistingContactsSourceResult {
  return { status: 'skipped', contacts: [], count: 0, reason };
}

function errorResult(reason: string): ExistingContactsSourceResult {
  return { status: 'error', contacts: [], count: 0, reason };
}

// ── Tests ─────────────────────────────────────────────────────

describe('readExistingContactsForCompany', () => {

  it('devuelve SellUp skipped cuando no hay accountId', async () => {
    const result = await readExistingContactsForCompany(
      { accountId: null, hubspotCompanyId: null },
      {
        readSellUp: async () => { throw new Error('no debe llamarse'); },
        readHubSpot: async () => skippedResult('Sin HubSpot Company ID'),
      }
    );

    assert.equal(result.sellup.status, 'skipped');
    assert.equal(result.sellup.count, 0);
    assert.ok(result.sellup.reason?.includes('Sin account ID'));
  });

  it('devuelve HubSpot skipped cuando no hay hubspotCompanyId', async () => {
    const result = await readExistingContactsForCompany(
      { accountId: 'acc-123', hubspotCompanyId: null },
      {
        readSellUp: async () => successResult([]),
        readHubSpot: async () => { throw new Error('no debe llamarse'); },
      }
    );

    assert.equal(result.hubspot.status, 'skipped');
    assert.equal(result.hubspot.count, 0);
    assert.ok(result.hubspot.reason?.includes('Sin HubSpot Company ID'));
  });

  it('lee contactos SellUp cuando hay accountId', async () => {
    const contacts = [
      makeContact({ fullName: 'Ana López', email: 'ana@corp.com' }),
      makeContact({ fullName: 'Luis García', email: 'luis@corp.com' }),
    ];

    const result = await readExistingContactsForCompany(
      { accountId: 'acc-abc', hubspotCompanyId: null },
      {
        readSellUp: async (id) => {
          assert.equal(id, 'acc-abc');
          return successResult(contacts);
        },
        readHubSpot: async () => skippedResult('Sin HubSpot Company ID'),
      }
    );

    assert.equal(result.sellup.status, 'success');
    assert.equal(result.sellup.count, 2);
    assert.equal(result.combined.sourceCounts.sellup, 2);
    assert.equal(result.combined.sourceCounts.hubspot, 0);
  });

  it('empresa manual sin accountId ni hubspotId no falla', async () => {
    const result = await readExistingContactsForCompany(
      { accountId: null, hubspotCompanyId: null },
      {
        readSellUp: async () => { throw new Error('no debe llamarse'); },
        readHubSpot: async () => { throw new Error('no debe llamarse'); },
      }
    );

    assert.equal(result.sellup.status, 'skipped');
    assert.equal(result.hubspot.status, 'skipped');
    assert.equal(result.combined.totalExistingContacts, 0);
    assert.equal(result.combined.sourceCounts.sellup, 0);
    assert.equal(result.combined.sourceCounts.hubspot, 0);
  });

  it('HubSpot error controlado no rompe el snapshot', async () => {
    const sellupContacts = [makeContact({ email: 'a@corp.com' })];

    const result = await readExistingContactsForCompany(
      { accountId: 'acc-xyz', hubspotCompanyId: 'hs-999' },
      {
        readSellUp: async () => successResult(sellupContacts),
        readHubSpot: async () => errorResult('Timeout de conexión'),
      }
    );

    assert.equal(result.sellup.status, 'success');
    assert.equal(result.hubspot.status, 'error');
    assert.equal(result.combined.sourceCounts.sellup, 1);
    assert.equal(result.combined.sourceCounts.hubspot, 0);
    assert.equal(result.combined.totalExistingContacts, 1);
  });

  it('deduplica por email entre SellUp y HubSpot', async () => {
    const sellupContacts = [
      makeContact({ source: 'sellup', fullName: 'Ana López', email: 'ana@corp.com', linkedinUrl: null }),
    ];
    const hubspotContacts = [
      makeContact({ source: 'hubspot', fullName: 'Ana Lopez', email: 'ana@corp.com', linkedinUrl: null }),
    ];

    const result = await readExistingContactsForCompany(
      { accountId: 'acc-1', hubspotCompanyId: 'hs-1' },
      {
        readSellUp: async () => successResult(sellupContacts),
        readHubSpot: async () => ({ status: 'success', contacts: hubspotContacts, count: 1 }),
      }
    );

    // Mismo email → 1 contacto único
    assert.equal(result.combined.totalExistingContacts, 1);
    assert.equal(result.combined.existingEmails.length, 1);
    assert.equal(result.combined.existingEmails[0], 'ana@corp.com');
  });

  it('deduplica por LinkedIn entre SellUp y HubSpot', async () => {
    const linkedinUrl = 'https://linkedin.com/in/juanperez';
    const sellupContacts = [
      makeContact({ source: 'sellup', fullName: 'Juan Pérez', email: null, linkedinUrl }),
    ];
    const hubspotContacts = [
      makeContact({ source: 'hubspot', fullName: 'Juan Perez', email: null, linkedinUrl }),
    ];

    const result = await readExistingContactsForCompany(
      { accountId: 'acc-1', hubspotCompanyId: 'hs-1' },
      {
        readSellUp: async () => successResult(sellupContacts),
        readHubSpot: async () => ({ status: 'success', contacts: hubspotContacts, count: 1 }),
      }
    );

    assert.equal(result.combined.totalExistingContacts, 1);
    assert.equal(result.combined.existingLinkedinUrls.length, 1);
  });

  it('contactos sin email ni LinkedIn distintos no se fusionan', async () => {
    const sellupContacts = [
      makeContact({ source: 'sellup', fullName: 'Juan Pérez', email: null, linkedinUrl: null }),
    ];
    const hubspotContacts = [
      makeContact({ source: 'hubspot', fullName: 'María Gómez', email: null, linkedinUrl: null }),
    ];

    const result = await readExistingContactsForCompany(
      { accountId: 'acc-1', hubspotCompanyId: 'hs-1' },
      {
        readSellUp: async () => successResult(sellupContacts),
        readHubSpot: async () => ({ status: 'success', contacts: hubspotContacts, count: 1 }),
      }
    );

    assert.equal(result.combined.totalExistingContacts, 2);
  });

  it('calcula contactos incompletos correctamente', async () => {
    const contacts = [
      makeContact({ email: null, phone: null, linkedinUrl: null,
        completeness: { hasEmail: false, hasPhone: false, hasLinkedin: false } }),
      makeContact({ email: 'a@b.com', phone: null, linkedinUrl: null,
        completeness: { hasEmail: true, hasPhone: false, hasLinkedin: false } }),
      makeContact({ email: 'c@d.com', phone: '+1', linkedinUrl: 'https://linkedin.com/in/x',
        completeness: { hasEmail: true, hasPhone: true, hasLinkedin: true } }),
    ];

    const result = await readExistingContactsForCompany(
      { accountId: 'acc-1', hubspotCompanyId: null },
      {
        readSellUp: async () => successResult(contacts),
        readHubSpot: async () => skippedResult('Sin HubSpot Company ID'),
      }
    );

    assert.equal(result.combined.incompleteContacts.missingEmail, 1);
    assert.equal(result.combined.incompleteContacts.missingPhone, 2);
    assert.equal(result.combined.incompleteContacts.missingLinkedin, 2);
  });

  it('combined incluye existingContactNames sin duplicados', async () => {
    const contacts = [
      makeContact({ fullName: 'Ana López', email: 'ana@corp.com', linkedinUrl: null }),
      makeContact({ fullName: 'Luis García', email: 'luis@corp.com', linkedinUrl: null }),
    ];

    const result = await readExistingContactsForCompany(
      { accountId: 'acc-1', hubspotCompanyId: null },
      {
        readSellUp: async () => successResult(contacts),
        readHubSpot: async () => skippedResult('Sin HubSpot Company ID'),
      }
    );

    assert.ok(result.combined.existingContactNames.includes('Ana López'));
    assert.ok(result.combined.existingContactNames.includes('Luis García'));
    assert.equal(result.combined.existingContactNames.length, 2);
  });

});

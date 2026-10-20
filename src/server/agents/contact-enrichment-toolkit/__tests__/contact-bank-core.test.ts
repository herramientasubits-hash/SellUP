import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACT_BANK_TTL_DAYS,
  isSatisfiedByContactBank,
  selectContactBankCandidates,
  type ContactBankEntry,
} from '../contact-bank-core';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const APOLLO_ID = '5f2a9c1e7b3d4a0012ab34cd';

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function entry(over: Partial<ContactBankEntry> = {}): ContactBankEntry {
  return {
    origin: 'candidate',
    originId: 'cand-1',
    originAccountId: 'acc-old',
    source: 'apollo',
    sourceContactId: APOLLO_ID,
    apolloPersonId: null,
    hubspotContactId: null,
    firstName: 'Ana',
    lastName: 'López',
    fullName: 'Ana López',
    title: 'Gerente de Recursos Humanos',
    seniority: 'manager',
    department: 'human_resources',
    country: 'CO',
    linkedinUrl: 'https://www.linkedin.com/in/ana-lopez',
    email: 'ana.lopez@acme.co',
    confidence: 0.8,
    foundAt: daysAgo(10),
    ...over,
  };
}

const EMPTY_BLOCKLIST = { doNotContact: [], suppressedProviderKeys: new Set<string>() };

function select(entries: ContactBankEntry[], over: Partial<Parameters<typeof selectContactBankCandidates>[0]> = {}) {
  return selectContactBankCandidates({ entries, known: [], blocklist: EMPTY_BLOCKLIST, now: NOW, ...over });
}

describe('Banco de contactos — qué entra', () => {
  it('ofrece un candidato vigente y relevante, conserva su origen y NO copia teléfonos', () => {
    const result = select([entry()]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.relevantWithEmail, 1);
    const row = result.rows[0];
    assert.equal(row.source, 'apollo');
    assert.equal(row.source_contact_id, APOLLO_ID);
    assert.equal(row.phone, null);
    assert.equal('apollo_person_id' in row, false);
    assert.equal(row.status, 'pending_review');
    assert.equal(row.duplicate_status, 'no_match');
    assert.equal(row.confidence, 0.8);
    assert.deepEqual((row.enrichment_metadata as { contact_bank: unknown }).contact_bank, {
      origin: 'candidate',
      origin_id: 'cand-1',
      origin_account_id: 'acc-old',
      original_source: 'apollo',
      found_at: daysAgo(10),
    });
  });

  it(`descarta lo encontrado hace más de ${CONTACT_BANK_TTL_DAYS} días y lo que no tiene fecha válida`, () => {
    const result = select([
      entry({ originId: 'old', foundAt: daysAgo(CONTACT_BANK_TTL_DAYS + 1) }),
      entry({ originId: 'bad', foundAt: 'no-es-fecha', email: 'b@acme.co', sourceContactId: null, source: 'hubspot' }),
    ]);
    assert.equal(result.rows.length, 0);
    assert.equal(result.skippedExpired, 2);
  });

  it('respeta «no contactar» de cualquier ficha de la compañía, por correo o por LinkedIn', () => {
    const result = select(
      [entry(), entry({ originId: 'c2', email: 'otra@acme.co', sourceContactId: 'aaaaaaaaaaaaaaaaaaaaaaaa', linkedinUrl: 'linkedin.com/in/luis' })],
      {
        blocklist: {
          doNotContact: [{ email: 'ANA.LOPEZ@acme.co', linkedinUrl: null }, { email: null, linkedinUrl: 'https://linkedin.com/in/luis/' }],
          suppressedProviderKeys: new Set(),
        },
      },
    );
    assert.equal(result.rows.length, 0);
    assert.equal(result.skippedBlocked, 2);
  });

  it('respeta la supresión del proveedor (DSAR), aunque la identidad venga por apollo_person_id', () => {
    const viaSource = select([entry()], {
      blocklist: { doNotContact: [], suppressedProviderKeys: new Set([`apollo::${APOLLO_ID}`]) },
    });
    assert.equal(viaSource.rows.length, 0);
    assert.equal(viaSource.skippedBlocked, 1);

    const viaColumn = select([entry({ source: 'lusha', sourceContactId: 'v1.lusha', apolloPersonId: APOLLO_ID })], {
      blocklist: { doNotContact: [], suppressedProviderKeys: new Set([`apollo::${APOLLO_ID}`]) },
    });
    assert.equal(viaColumn.rows.length, 0);

    const lusha = select([entry({ source: 'lusha', sourceContactId: 'v1.abc' })], {
      blocklist: { doNotContact: [], suppressedProviderKeys: new Set(['lusha::v1.abc']) },
    });
    assert.equal(lusha.rows.length, 0);
  });

  it('falla cerrado: un registro de Apollo/Lusha sin identidad verificable no entra', () => {
    const result = select([
      entry({ originId: 'a', sourceContactId: 'no-es-un-id-de-apollo' }),
      entry({ originId: 'l', source: 'lusha', sourceContactId: null, email: 'l@acme.co' }),
    ]);
    assert.equal(result.rows.length, 0);
    assert.equal(result.skippedUnverifiableIdentity, 2);
  });

  it('no repite a quien ya está en la empresa o en esta corrida (correo, LinkedIn o id del proveedor)', () => {
    const result = select(
      [
        entry({ originId: 'e' }),
        entry({ originId: 'l', email: 'x@acme.co', sourceContactId: 'bbbbbbbbbbbbbbbbbbbbbbbb', linkedinUrl: 'linkedin.com/in/known' }),
        entry({ originId: 'p', email: 'y@acme.co', linkedinUrl: null, sourceContactId: 'cccccccccccccccccccccccc' }),
      ],
      {
        known: [
          { email: 'ana.lopez@ACME.co', linkedinUrl: null },
          { email: null, linkedinUrl: 'https://www.linkedin.com/in/known?trk=x' },
          { email: null, linkedinUrl: null, source: 'apollo', sourceContactId: 'cccccccccccccccccccccccc' },
        ],
      },
    );
    assert.equal(result.rows.length, 0);
    assert.equal(result.skippedKnown, 3);
  });

  it('la misma persona en dos fichas entra una vez, y gana el contacto aprobado', () => {
    const result = select([
      entry({ originId: 'cand', foundAt: daysAgo(1) }),
      entry({ origin: 'contact', originId: 'contact', source: 'agent_1', sourceContactId: null, foundAt: daysAgo(30) }),
    ]);
    assert.equal(result.rows.length, 1);
    const row = result.rows[0];
    assert.equal((row.enrichment_metadata as { contact_bank: { origin_id: string } }).contact_bank.origin_id, 'contact');
    // agent_1 no existe en el vocabulario del candidato: queda «manual» y el origen real en metadata.
    assert.equal(row.source, 'manual');
    assert.equal(row.confidence, 1);
  });

  it('descarta cargos que no son del perfil de UBITS y nombres vacíos o de relleno de HubSpot', () => {
    const result = select([
      entry({ originId: 'cfo', title: 'Director Financiero', email: 'cfo@acme.co', sourceContactId: 'dddddddddddddddddddddddd' }),
      entry({ originId: 'blank', fullName: '  ', email: 'z@acme.co' }),
      entry({ originId: 'hs', source: 'hubspot', sourceContactId: '901', fullName: 'HubSpot Contact 901', email: 'h@acme.co' }),
    ]);
    assert.equal(result.rows.length, 0);
    assert.equal(result.skippedNotRelevant, 1);
    assert.equal(result.skippedNoName, 2);
  });

  it('un contacto de HubSpot conserva su vínculo para no duplicarlo en HubSpot al aprobar', () => {
    const result = select([
      entry({ origin: 'contact', source: 'hubspot', sourceContactId: null, hubspotContactId: '12345' }),
    ]);
    assert.equal(result.rows[0].source, 'hubspot');
    assert.equal(result.rows[0].source_contact_id, '12345');
    assert.equal(result.rows[0].matched_hubspot_contact_id, '12345');
  });

  it('sólo cuenta para «bastan» a quien tiene correo', () => {
    const result = select([entry({ email: null })]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.relevantWithEmail, 0);
  });
});

describe('Banco de contactos — cuándo basta', () => {
  it('basta con 3 relevantes con correo, igual que «Primero HubSpot»', () => {
    assert.equal(isSatisfiedByContactBank(2), false);
    assert.equal(isSatisfiedByContactBank(3), true);
  });
});

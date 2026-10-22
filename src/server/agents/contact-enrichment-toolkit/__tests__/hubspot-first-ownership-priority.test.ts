import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hubspotFirstPriority,
  isOfferableHubSpotContact,
  selectHubSpotFirstCandidates,
  type HubSpotFirstOwnership,
} from '../hubspot-first-core';
import { runHubSpotFirstStage, withPriorityTimestamps } from '../hubspot-first-stage.server';
import type { ExistingContactSnapshot } from '@/modules/contact-enrichment/types';

const DIRECTORY = {
  activeIds: new Set(['seller-me', 'seller-other']),
  deactivatedIds: new Set(['seller-gone']),
  poolIds: new Set(['pool-1']),
};
const OWNERSHIP: HubSpotFirstOwnership = { sellerOwnerId: 'seller-me', directory: DIRECTORY };

function contact(id: string, title: string, ownerId: string | null = null): ExistingContactSnapshot {
  return {
    id,
    source: 'hubspot',
    fullName: `Persona ${id} Apellido`,
    firstName: `Persona${id}`,
    lastName: 'Apellido',
    email: `p${id}@davivienda.com`,
    title,
    ownerId,
    completeness: { hasEmail: true, hasPhone: false, hasLinkedin: false },
  };
}

describe('«HubSpot primero» — de quién es cada contacto', () => {
  it('pasan los sin dueño, los propios, los de una bolsa y los de un dueño desactivado', () => {
    for (const owner of [null, '', 'seller-me', 'pool-1', 'seller-gone']) {
      assert.equal(isOfferableHubSpotContact(owner, OWNERSHIP), true, String(owner));
    }
  });
  it('NUNCA el de otro vendedor activo', () => {
    assert.equal(isOfferableHubSpotContact('seller-other', OWNERSHIP), false);
  });
  it('el dueño de la FICHA también cuenta aunque busque otra persona (Grupo LALA, 22-10)', () => {
    const asLeader: HubSpotFirstOwnership = { ...OWNERSHIP, sellerOwnerId: 'leader', accountOwnerId: 'seller-other' };
    assert.equal(isOfferableHubSpotContact('seller-other', asLeader), true);
    assert.equal(isOfferableHubSpotContact('seller-third', asLeader), false);
    // Sin dueño de ficha conocido, la regla de siempre.
    assert.equal(isOfferableHubSpotContact('seller-other', { ...OWNERSHIP, accountOwnerId: null }), false);
  });

  it('sin directorio ni dueño del vendedor: sólo los sin dueño (falla cerrado)', () => {
    const unknown: HubSpotFirstOwnership = { sellerOwnerId: null, directory: null };
    assert.equal(isOfferableHubSpotContact(null, unknown), true);
    assert.equal(isOfferableHubSpotContact('pool-1', unknown), false);
    assert.equal(isOfferableHubSpotContact('seller-me', unknown), false);
  });
  it('la selección los cuenta aparte', () => {
    const result = selectHubSpotFirstCandidates({
      hubspotContacts: [contact('1', 'Gerente de Recursos Humanos', 'seller-other'), contact('2', 'Gerente de Recursos Humanos', 'seller-me')],
      sellupContacts: [],
      alreadyInRunHubspotIds: new Set(),
      ownership: OWNERSHIP,
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.skippedOtherSeller, 1);
    assert.equal(result.rows[0].source_contact_id, '2');
  });
});

describe('«HubSpot primero» — lo más importante primero', () => {
  it('formación con mando, luego RR. HH. con mando, gerencia, y al final lo operativo', () => {
    assert.equal(hubspotFirstPriority('Director de Formación', 'learning'), 0);
    assert.equal(hubspotFirstPriority('Subgerente de Talento Humano', 'talent'), 1);
    assert.equal(hubspotFirstPriority('Gerente General / CEO', 'executive_sponsor'), 2);
    assert.equal(hubspotFirstPriority('Especialista en Aprendizaje', 'learning'), 3);
    assert.equal(hubspotFirstPriority('HR Business Partner', 'hr'), 4);
    assert.equal(hubspotFirstPriority('Gestor Bienestar', 'wellbeing'), 5);
  });

  it('la selección sale ordenada y, a igual prioridad, respeta el orden de HubSpot', () => {
    const result = selectHubSpotFirstCandidates({
      hubspotContacts: [
        contact('a', 'HR Business Partner'),
        contact('b', 'Gerente General'),
        contact('c', 'Jefe de Formación y Desarrollo'),
        contact('d', 'Gerente Recursos Humanos'),
        contact('e', 'Coordinador de RRHH'),
      ],
      sellupContacts: [],
      alreadyInRunHubspotIds: new Set(),
    });
    assert.deepEqual(result.rows.map((r) => r.source_contact_id), ['c', 'd', 'b', 'a', 'e']);
  });

  it('las marcas de tiempo bajan de a 1 ms: la lista (más nuevo primero) respeta el orden', () => {
    const rows = withPriorityTimestamps([{ id: 'x' }, { id: 'y' }, { id: 'z' }], Date.parse('2026-10-20T21:00:00.000Z'));
    assert.deepEqual(rows.map((r) => r.created_at), ['2026-10-20T21:00:00.000Z', '2026-10-20T20:59:59.999Z', '2026-10-20T20:59:59.998Z']);
  });

  it('la etapa inserta ya ordenado y le pasa el vendedor a la resolución del dueño', async () => {
    let inserted: Array<{ source_contact_id: string; created_at?: string }> = [];
    let askedFor: string | null = 'nadie';
    await runHubSpotFirstStage(
      { attemptId: 'a1', triggeredBy: 'user-1' },
      {
        loadRunRef: async () => ({ accountId: 'acc', hubspotCompanyId: 'hs-co' }),
        readSnapshot: async () =>
          ({
            sellup: { status: 'success', contacts: [], count: 0 },
            hubspot: {
              status: 'success',
              contacts: [contact('ops', 'Generalista de RRHH'), contact('lead', 'Learning Manager'), contact('rival', 'Directora de Talento', 'seller-other')],
              count: 3,
            },
            combined: {},
          }) as never,
        loadRunHubspotCandidates: async () => [],
        insertRows: async (_id, rows) => {
          inserted = rows as typeof inserted;
          return {};
        },
        resolveOwnership: async (who) => {
          askedFor = who;
          return OWNERSHIP;
        },
        now: () => Date.parse('2026-10-20T21:00:00.000Z'),
      },
    );
    assert.equal(askedFor, 'user-1');
    assert.deepEqual(inserted.map((r) => r.source_contact_id), ['lead', 'ops']);
    assert.ok((inserted[0].created_at ?? '') > (inserted[1].created_at ?? ''));
  });
});

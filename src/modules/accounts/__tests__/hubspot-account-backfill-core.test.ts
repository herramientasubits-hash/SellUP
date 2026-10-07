import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideHubSpotLink, pickBackfillSearcher } from '../hubspot-account-backfill-core';

describe('decideHubSpotLink', () => {
  it('ID que existe en el HubSpot real: se queda', () => {
    assert.deepEqual(
      decideHubSpotLink({ currentHubspotCompanyId: '1', currentStatus: 'found', domainMatchIds: null }),
      { action: 'keep', hubspotCompanyId: '1' },
    );
  });

  it('ID del sandbox (404) con una sola empresa real del mismo dominio: se revincula', () => {
    assert.deepEqual(
      decideHubSpotLink({ currentHubspotCompanyId: '56069508491', currentStatus: 'not_found', domainMatchIds: ['999', '999'] }),
      { action: 'relink', hubspotCompanyId: '999', previousHubspotCompanyId: '56069508491' },
    );
  });

  it('varias empresas reales con el mismo dominio: a revisión, nunca se elige sola', () => {
    assert.deepEqual(
      decideHubSpotLink({ currentHubspotCompanyId: null, currentStatus: 'none', domainMatchIds: ['1', '2'] }),
      { action: 'review', candidateIds: ['1', '2'], previousHubspotCompanyId: null },
    );
  });

  it('sin empresa real: queda marcada como faltante en HubSpot', () => {
    assert.deepEqual(
      decideHubSpotLink({ currentHubspotCompanyId: '5', currentStatus: 'not_found', domainMatchIds: [] }),
      { action: 'missing_in_hubspot', previousHubspotCompanyId: '5' },
    );
  });

  it('HubSpot no responde: no se toca nada aunque haya coincidencias', () => {
    assert.deepEqual(
      decideHubSpotLink({ currentHubspotCompanyId: '5', currentStatus: 'unavailable', domainMatchIds: ['9'] }),
      { action: 'unavailable' },
    );
  });
});

describe('pickBackfillSearcher', () => {
  it('prefiere quien buscó contactos, luego el creador del lote del Agente 1, luego el creador', () => {
    assert.equal(pickBackfillSearcher({ contactSearchTriggeredBy: 'a', agent1BatchCreatedBy: 'b', accountCreatedBy: 'c' }), 'a');
    assert.equal(pickBackfillSearcher({ contactSearchTriggeredBy: null, agent1BatchCreatedBy: 'b', accountCreatedBy: 'c' }), 'b');
    assert.equal(pickBackfillSearcher({ contactSearchTriggeredBy: null, agent1BatchCreatedBy: null, accountCreatedBy: 'c' }), 'c');
  });
});

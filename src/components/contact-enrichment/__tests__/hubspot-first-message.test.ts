import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomaticRoutingMessage } from '../contact-enrichment-chat-reducer';
import type { AutomaticRoutingUiDiagnosis, AutomaticRoutingUiResult } from '../contact-enrichment-chat-types';

function result(over: Partial<AutomaticRoutingUiResult>): AutomaticRoutingUiResult {
  return {
    success: true, status: 'no_fallback_needed', automaticRoutingEnabled: true, fallbackExecuted: false,
    attempt1AttemptId: 'a1', attempt2AttemptId: null, blockedReason: null, reusedExistingCandidates: 0,
    providerCandidatesCreated: { apollo: null, lusha: null }, failedProviders: [], ...over,
  };
}

function diag(
  hubspotFirst: AutomaticRoutingUiDiagnosis['hubspotFirst'],
  hubspotStage = 'done',
): AutomaticRoutingUiDiagnosis {
  return {
    apolloSkipped: false, apolloOrganization: 'found_by_domain', apolloPeopleFound: 5, apolloRejected: 0,
    apolloAlreadyKnown: 0, freeStages: { hubspotFirst: hubspotStage, contactBank: 'done', companySite: 'not_reached' },
    lushaRecentZeroAt: null, lushaRan: false, hubspotFirst,
  };
}

const hs = (over: Partial<NonNullable<AutomaticRoutingUiDiagnosis['hubspotFirst']>>) => ({
  hubspotContacts: 0, otherSeller: 0, knownInSellUp: 0, notRelevant: 0, noName: 0, alreadyPending: 0, ...over,
});

describe('AGENT2A-COMPANY-SEARCH-COUNTS — el chat separa HubSpot, otras fuentes y «Por revisar» anterior', () => {
  it('dice cuántos tenía HubSpot, cuántos trajo, cuántos pasaron a Contactos y cuántos esperaban de antes', () => {
    const { content, tone } = buildAutomaticRoutingMessage(
      result({
        hubspotFirstCandidates: 5,
        hubspotAutoApprovedContacts: 2,
        providerCandidatesCreated: { apollo: 3, lusha: 1 },
        previousPendingReviewCandidates: 6,
        diagnosis: diag(hs({ hubspotContacts: 12, otherSeller: 3, knownInSellUp: 2, notRelevant: 1, alreadyPending: 1 })),
      }),
    );
    assert.equal(
      content,
      'Terminé la búsqueda:\n\n' +
        '• De HubSpot: tiene 12 contactos de esta empresa y traje 5: 2 pasaron directo a Contactos porque ya tenían correo, teléfono y LinkedIn, y 3 quedaron en «Por revisar». ' +
        'Los otros no los traje: 1 ya estaba en «Por revisar», 2 ya están en SellUp, 3 son de otro vendedor y 1 no es de RR. HH., formación o dirección.\n' +
        '• De otras fuentes: 4 contactos nuevos en «Por revisar» (3 de Apollo y 1 de Lusha).\n' +
        '• De búsquedas anteriores: ya tenías 6 contactos en «Por revisar».\n\n' +
        'Los de «Por revisar» requieren tu aprobación.',
    );
    assert.equal(tone, undefined);
  });

  it('todos los de HubSpot completos: todos a Contactos', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({
        hubspotFirstCandidates: 2,
        hubspotAutoApprovedContacts: 2,
        providerCandidatesCreated: { apollo: 0, lusha: null },
        previousPendingReviewCandidates: 0,
        diagnosis: diag(hs({ hubspotContacts: 2 })),
      }),
    );
    assert.match(content, /De HubSpot: tiene 2 contactos de esta empresa y traje 2: pasaron directo a Contactos porque ya tenían correo, teléfono y LinkedIn\./);
    assert.match(content, /De otras fuentes: no encontré contactos nuevos\./);
    assert.doesNotMatch(content, /requieren tu aprobación/);
  });

  it('ninguno de HubSpot completo: todos a «Por revisar»', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({ hubspotFirstCandidates: 3, diagnosis: diag(hs({ hubspotContacts: 3 })) }),
    );
    assert.match(content, /De HubSpot: tiene 3 contactos de esta empresa y traje 3: quedaron en «Por revisar»\./);
  });

  it('banco de contactos y sitio web cuentan como otras fuentes', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({ contactBankCandidates: 2, companySiteCandidates: 1, providerCandidatesCreated: { apollo: 1, lusha: null } }),
    );
    assert.match(
      content,
      /De otras fuentes: 4 contactos nuevos en «Por revisar» \(1 de Apollo, 2 que SellUp ya conocía de otra ficha y 1 del sitio web, sin correo\)\./,
    );
  });

  it('empresa sin HubSpot o HubSpot caído: lo dice en su línea', () => {
    assert.match(
      buildAutomaticRoutingMessage(
        result({ providerCandidatesCreated: { apollo: 1, lusha: null }, diagnosis: diag(null, 'no_hubspot_company') }),
      ).content,
      /De HubSpot: esta empresa no está vinculada a HubSpot\./,
    );
    assert.match(
      buildAutomaticRoutingMessage(
        result({ providerCandidatesCreated: { apollo: 1, lusha: null }, diagnosis: diag(null, 'hubspot_unavailable') }),
      ).content,
      /De HubSpot: no pude leerlo esta vez\./,
    );
  });

  it('sólo pendientes de antes y uno de antes pasado a Contactos: no es un cero', () => {
    const { content, tone } = buildAutomaticRoutingMessage(
      result({
        providerCandidatesCreated: { apollo: 0, lusha: null },
        previousPendingReviewCandidates: 2,
        hubspotAutoApprovedEarlierContacts: 1,
        diagnosis: diag(hs({ hubspotContacts: 0 })),
      }),
    );
    assert.match(content, /^Esta búsqueda no trajo contactos nuevos:/);
    assert.match(content, /De HubSpot: no tiene contactos de esta empresa\./);
    assert.match(content, /ya tenías 2 contactos en «Por revisar»\. Además pasé 1 de HubSpot a Contactos porque ya estaba completo\./);
    assert.equal(tone, undefined);
  });

  it('sin el conteo nuevo usa los pendientes que el enrutador reutilizó', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({ reusedExistingCandidates: 3, providerCandidatesCreated: { apollo: 0, lusha: null } }),
    );
    assert.match(content, /De búsquedas anteriores: ya tenías 3 contactos en «Por revisar»\./);
  });
});

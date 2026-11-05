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

describe('AGENT2A-COMPANY-SEARCH-COUNTS — el chat: aprobados y por aprobar, y el detalle por fuente', () => {
  it('primero las dos líneas de siempre y debajo el detalle de HubSpot y las otras fuentes', () => {
    const { content, tone } = buildAutomaticRoutingMessage(
      result({
        hubspotFirstCandidates: 5,
        hubspotAutoApprovedContacts: 2,
        providerCandidatesCreated: { apollo: 3, lusha: 1 },
        previousPendingReviewCandidates: 6,
        approvedContactsTotal: 7,
        diagnosis: diag(hs({ hubspotContacts: 12, otherSeller: 3, knownInSellUp: 2, notRelevant: 1, alreadyPending: 1 })),
      }),
    );
    assert.equal(
      content,
      'Terminé la búsqueda:\n\n' +
        '• 7 contactos aprobados | 2 contactos nuevos\n' +
        '• 13 contactos por aprobar | 7 encontrados, 6 de ejecuciones anteriores\n\n' +
        'Detalle de esta búsqueda:\n' +
        '• De HubSpot: 2 aprobados (completos), 3 por aprobar, 2 ya en SellUp, 3 de otro vendedor y 1 de otras áreas.\n' +
        '• De otras fuentes: 4 contactos nuevos por aprobar (3 de Apollo y 1 de Lusha).',
    );
    assert.equal(tone, undefined);
  });

  it('todos los de HubSpot completos: aprobados, nada por aprobar', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({
        hubspotFirstCandidates: 2,
        hubspotAutoApprovedContacts: 2,
        providerCandidatesCreated: { apollo: 0, lusha: null },
        previousPendingReviewCandidates: 0,
        diagnosis: diag(hs({ hubspotContacts: 2 })),
      }),
    );
    assert.match(content, /• 2 contactos aprobados \| 2 contactos nuevos/);
    assert.match(content, /• 0 contactos por aprobar \| 0 encontrados, 0 de ejecuciones anteriores/);
    assert.match(content, /De HubSpot: 2 aprobados \(completos\)\./);
    assert.match(content, /De otras fuentes: no encontré contactos nuevos\./);
  });

  it('ninguno de HubSpot completo: todos por aprobar', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({ hubspotFirstCandidates: 3, diagnosis: diag(hs({ hubspotContacts: 3 })) }),
    );
    assert.match(content, /De HubSpot: 3 por aprobar\./);
    assert.match(content, /• 3 contactos por aprobar \| 3 encontrados, 0 de ejecuciones anteriores/);
  });

  it('banco de contactos y sitio web cuentan como otras fuentes', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({ contactBankCandidates: 2, companySiteCandidates: 1, providerCandidatesCreated: { apollo: 1, lusha: null } }),
    );
    assert.match(
      content,
      /De otras fuentes: 4 contactos nuevos por aprobar \(1 de Apollo, 2 que SellUp ya conocía de otra ficha y 1 del sitio web, sin correo\)\./,
    );
  });

  it('empresa sin HubSpot o HubSpot caído: lo dice en su línea', () => {
    assert.match(
      buildAutomaticRoutingMessage(
        result({ providerCandidatesCreated: { apollo: 1, lusha: null }, diagnosis: diag(null, 'no_hubspot_company') }),
      ).content,
      /De HubSpot: la empresa no está vinculada a HubSpot\./,
    );
    assert.match(
      buildAutomaticRoutingMessage(
        result({ providerCandidatesCreated: { apollo: 1, lusha: null }, diagnosis: diag(null, 'hubspot_unavailable') }),
      ).content,
      /De HubSpot: no pude leerlo esta vez\./,
    );
  });

  it('nada nuevo pero uno de antes aprobado ahora: lo cuenta como nuevo aprobado', () => {
    const { content, tone } = buildAutomaticRoutingMessage(
      result({
        providerCandidatesCreated: { apollo: 0, lusha: null },
        previousPendingReviewCandidates: 2,
        hubspotAutoApprovedEarlierContacts: 1,
        approvedContactsTotal: 4,
        diagnosis: diag(hs({ hubspotContacts: 0 })),
      }),
    );
    assert.match(content, /^Esta búsqueda no trajo contactos nuevos:/);
    assert.match(content, /• 4 contactos aprobados \| 1 contacto nuevo/);
    assert.match(content, /• 2 contactos por aprobar \| 0 encontrados, 2 de ejecuciones anteriores/);
    assert.match(content, /De búsquedas anteriores: aprobé 1 contacto de HubSpot que ya estaba completo\./);
    assert.equal(tone, undefined);
  });

  it('Bryan 04-11 — sin nada nuevo igual muestra lo que ya se hizo en la empresa', () => {
    const { content, tone } = buildAutomaticRoutingMessage(
      result({
        providerCandidatesCreated: { apollo: 0, lusha: 0 },
        previousPendingReviewCandidates: 3,
        approvedContactsTotal: 5,
      }),
    );
    assert.match(content, /^No se encontraron contactos nuevos\./);
    assert.match(content, /• 5 contactos aprobados \| 0 contactos nuevos/);
    assert.match(content, /• 3 contactos por aprobar \| 0 encontrados, 3 de ejecuciones anteriores/);
    assert.equal(tone, undefined);
  });

  it('sin nada en la empresa: las cifras en cero y el aviso de advertencia', () => {
    const { content, tone } = buildAutomaticRoutingMessage(result({ providerCandidatesCreated: { apollo: 0, lusha: 0 } }));
    assert.match(content, /• 0 contactos aprobados \| 0 contactos nuevos/);
    assert.match(content, /• 0 contactos por aprobar \| 0 encontrados, 0 de ejecuciones anteriores/);
    assert.equal(tone, 'warning');
  });

  it('ninguno nuevo de HubSpot: dice por qué, corto; el dueño sin verificar no se llama «otro vendedor»', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({
        providerCandidatesCreated: { apollo: 1, lusha: null },
        diagnosis: diag(hs({ hubspotContacts: 6, otherSeller: 3, ownerUnverified: 2, knownInSellUp: 1 })),
      }),
    );
    assert.match(content, /De HubSpot: ninguno nuevo \(1 ya en SellUp, 3 de otro vendedor y 2 con dueño sin verificar\)\./);
  });

  it('sin el conteo nuevo usa los pendientes que el enrutador reutilizó', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({ reusedExistingCandidates: 3, providerCandidatesCreated: { apollo: 0, lusha: null } }),
    );
    assert.match(content, /• 3 contactos por aprobar \| 0 encontrados, 3 de ejecuciones anteriores/);
  });
});

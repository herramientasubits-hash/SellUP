/**
 * FEEDBACK 24-11 — ex clientes (churn) en HubSpot.
 *
 * En el portal de UBITS el churn se marca en «Estado de la cuenta» = Churn y la etapa
 * sigue en «Cliente» (934 de 935, leído el 24-11). Antes SellUp miraba sólo la etapa:
 * cada ex cliente se bloqueaba como cliente actual y nunca salía como ex cliente.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHubSpotOwnerDirectory,
  classifyHubSpotCompanyAvailability,
  describeHubSpotChurn,
  HUBSPOT_FREE_POLICY_PROPERTIES,
  isHubSpotCurrentCustomer,
  readHubSpotChurn,
} from '@/server/integrations/hubspot-free-company-policy';
import { classifyHubSpotCommercialMatch } from '@/server/agents/prospecting-toolkit/hubspot-commercial-checker';
import type { HubSpotExtendedCompanyMatch } from '@/server/agents/prospecting-toolkit/hubspot-commercial-checker';
import { markFreeHubSpotMatchesPure } from '@/server/agents/prospecting-toolkit/hubspot-free-match';
import type { DuplicateMatch } from '@/server/agents/prospecting-toolkit/types';
import { readHubSpotExCustomer, resolveDuplicateVerdict } from '@/components/prospects/duplicate-verdict';
import { isHubSpotCustomerProperties } from '@/server/prospect-batches/competitor-search/competitor-map.server';
import { buildRequestFacts } from '@/server/agents/first-call/internal-facts';

const NOW = new Date('2026-11-24T12:00:00Z');
const OWNERS = buildHubSpotOwnerDirectory(
  [{ id: '10', firstName: 'Ana', lastName: 'Vendedora' }, { id: '20', firstName: 'Sales', lastName: 'Colombia' }],
  [],
);
const CLIENT = '1443029400';
const CHURNED = { lifecyclestage: CLIENT, estado_de_la_cuenta: 'Churn', fecha_ultimo_churn: '2025-03-01', razon_de_churn: 'Pricing & Billing' };

describe('regla de cliente actual', () => {
  it('etapa «Cliente» sin churn sigue siendo cliente', () => {
    assert.equal(isHubSpotCurrentCustomer({ lifecyclestage: CLIENT }), true);
    assert.equal(isHubSpotCurrentCustomer({ lifecyclestage: CLIENT, estado_de_la_cuenta: 'Empresa de Pago' }), true);
  });

  it('etapa «Cliente» con Estado de la cuenta = Churn ya no es cliente', () => {
    assert.equal(isHubSpotCurrentCustomer(CHURNED), false);
    assert.equal(isHubSpotCurrentCustomer({ ...CHURNED, hs_lead_status: 'Customer' }), false);
  });

  it('«Forecast» bloquea aunque la cuenta tenga churn: hay un negocio en pronóstico', () => {
    assert.equal(isHubSpotCurrentCustomer({ ...CHURNED, lifecyclestage: 'customer' }), true);
  });

  it('lee cuándo y por qué se fue', () => {
    assert.deepEqual(readHubSpotChurn(CHURNED), { churnedAt: '2025-03-01', reason: 'Pricing & Billing' });
    assert.deepEqual(readHubSpotChurn({ estado_de_la_cuenta: 'Churn', fecha_ultimo_churn: '1740787200000' }), {
      churnedAt: '2025-03-01',
      reason: null,
    });
    assert.equal(readHubSpotChurn({ lifecyclestage: CLIENT }), null);
    assert.equal(describeHubSpotChurn({ churnedAt: '2025-03-01', reason: 'Externo' }), 'Ex cliente de UBITS (churn 2025-03-01 · Externo)');
    assert.equal(describeHubSpotChurn({ churnedAt: null, reason: null }), 'Ex cliente de UBITS (churn)');
  });

  it('la regla pide las propiedades del churn a HubSpot', () => {
    for (const name of ['estado_de_la_cuenta', 'fecha_ultimo_churn', 'razon_de_churn']) {
      assert.ok((HUBSPOT_FREE_POLICY_PROPERTIES as readonly string[]).includes(name), name);
    }
  });
});

describe('empresa libre: un ex cliente pasa por la misma regla que cualquier ficha', () => {
  it('ex cliente reciclado ⇒ libre, con la marca de churn', () => {
    const verdict = classifyHubSpotCompanyAvailability({ ...CHURNED, hs_lead_status: 'Recycled', hubspot_owner_id: '10' }, OWNERS, NOW);
    assert.deepEqual(verdict, { free: true, reason: 'recycled', churn: { churnedAt: '2025-03-01', reason: 'Pricing & Billing' } });
  });

  it('ex cliente en la bolsa ⇒ libre aunque su estado de lead siga en «Customer»', () => {
    const verdict = classifyHubSpotCompanyAvailability({ ...CHURNED, hs_lead_status: 'Customer', hubspot_owner_id: '20' }, OWNERS, NOW);
    assert.equal(verdict.free, true);
    assert.equal(verdict.reason, 'pool_owner');
  });

  it('ex cliente con dueño activo ⇒ tomado por su dueño, no por «cliente»', () => {
    const verdict = classifyHubSpotCompanyAvailability({ ...CHURNED, hubspot_owner_id: '10' }, OWNERS, NOW);
    assert.equal(verdict.free, false);
    assert.equal(verdict.reason, 'active_owner');
    assert.ok(verdict.churn);
  });

  it('ex cliente con negocio abierto o actividad reciente ⇒ sigue tomado', () => {
    assert.equal(classifyHubSpotCompanyAvailability({ ...CHURNED, hs_num_open_deals: '1' }, OWNERS, NOW).reason, 'open_deal');
    assert.equal(
      classifyHubSpotCompanyAvailability({ ...CHURNED, notes_last_updated: '2026-11-20T00:00:00Z' }, OWNERS, NOW).reason,
      'recent_sales_activity',
    );
  });

  it('cliente actual sigue bloqueado como cliente, sin marca de churn', () => {
    const verdict = classifyHubSpotCompanyAvailability({ lifecyclestage: CLIENT, hs_lead_status: 'Recycled' }, OWNERS, NOW);
    assert.deepEqual(verdict, { free: false, reason: 'customer' });
  });

  it('la coincidencia libre lleva la marca y el motivo la dice', () => {
    const match: DuplicateMatch = {
      source: 'hubspot',
      status: 'existing_in_hubspot',
      confidence: 92,
      matchedId: '555',
      reason: 'Dominio exacto',
    };
    const [marked] = markFreeHubSpotMatchesPure([match], () => ({
      availability: { free: true, reason: 'recycled', churn: { churnedAt: '2025-03-01', reason: 'Externo' } },
      ownerId: '10',
    }));
    assert.equal(marked.status, 'new_candidate');
    assert.deepEqual(marked.hubspotFreeToTake?.churn, { churnedAt: '2025-03-01', reason: 'Externo' });
    assert.match(marked.reason, /^Ex cliente de UBITS \(churn 2025-03-01 · Externo\) · Libre en HubSpot/);
  });
});

describe('verificación comercial (agregar a mano, fuentes, Rumbo)', () => {
  const base: HubSpotExtendedCompanyMatch = {
    hubspotCompanyId: '1',
    name: 'Acme',
    domain: 'acme.co',
    nit: null,
    lifecycleStage: CLIENT,
    leadStatus: null,
    ownerId: null,
    lastMeetingDate: null,
    lastActivityDate: null,
    numberOfEmployees: null,
    numberOfDeals: null,
    matchMethod: 'domain',
    matchConfidence: 95,
    commercialStatus: 'unknown',
    recyclableReason: null,
  };

  it('etapa «Cliente» con churn ⇒ ex cliente, no cliente actual', () => {
    const result = classifyHubSpotCommercialMatch({
      company: { ...base, churn: { churnedAt: '2025-03-01', reason: 'Externo' } },
      matchMethod: 'domain',
      now: NOW,
    });
    assert.equal(result.hubspotMatchStatus, 'exact_match_ex_customer');
    assert.equal(result.commercialStatus, 'ex_customer');
    assert.equal(result.reason, 'Ex cliente de UBITS: churn el 2025-03-01 (Externo)');
  });

  it('etapa «Cliente» sin churn ⇒ cliente actual', () => {
    const result = classifyHubSpotCommercialMatch({ company: base, matchMethod: 'domain', now: NOW });
    assert.equal(result.hubspotMatchStatus, 'exact_match_customer');
  });

  it('«Unqualified / lost» ya no se lee como ex cliente: es un prospecto que no avanzó', () => {
    const result = classifyHubSpotCommercialMatch({
      company: { ...base, lifecycleStage: 'lead', leadStatus: 'Unqualified / lost', lastActivityDate: '2026-01-01' },
      matchMethod: 'domain',
      now: NOW,
    });
    assert.notEqual(result.commercialStatus, 'ex_customer');
  });

  it('Rumbo dice que fue cliente, cuándo se fue y por qué (sin «etapa cliente»)', () => {
    const [fact] = buildRequestFacts({
      hubspot: {
        status: 'ex_customer',
        lifecycleStage: CLIENT,
        lastActivityDate: null,
        numberOfDeals: null,
        churn: { churnedAt: '2025-03-01', reason: 'Externo' },
      },
      decisionMaker: null,
    });
    assert.equal(
      fact?.statement,
      'Fue cliente de UBITS en el pasado según HubSpot (dejó de serlo el 2025-03-01, razón del churn: Externo).',
    );
  });
});

describe('lo que ve quien revisa', () => {
  it('lee la marca del escritor y la muestra en el veredicto', () => {
    const metadata = { hubspot_free_pool: { company_id: '1', reason: 'recycled', ex_customer: { churned_at: '2025-03-01', churn_reason: 'Externo' } } };
    const exCustomer = readHubSpotExCustomer(metadata);
    assert.equal(exCustomer, 'Ex cliente de UBITS (churn 2025-03-01 · Externo)');
    const verdict = resolveDuplicateVerdict({
      duplicateStatus: 'unique',
      matchedInHubspot: false,
      matchedInSellup: false,
      hubspotChecked: true,
      hubspotFreeReason: 'recycled',
      hubspotExCustomer: exCustomer,
    });
    assert.equal(verdict.label, 'Ex cliente · libre en HubSpot');
    assert.match(verdict.detail, /^Ex cliente de UBITS \(churn 2025-03-01 · Externo\)\. Ya está en HubSpot, libre/);
  });

  it('también desde la importación, y sin marca no dice nada', () => {
    const fromImport = { validation: { hubspot_duplicate_check: { free_to_take: { reason: 'no_owner', ex_customer: { churned_at: null, churn_reason: null } } } } };
    assert.equal(readHubSpotExCustomer(fromImport), 'Ex cliente de UBITS (churn)');
    assert.equal(readHubSpotExCustomer({ hubspot_free_pool: { reason: 'recycled' } }), null);
  });

  it('competidores: un ex cliente no figura como «ya trabaja con UBITS»', () => {
    assert.equal(isHubSpotCustomerProperties(CHURNED), false);
    assert.equal(isHubSpotCustomerProperties({ lifecyclestage: CLIENT }), true);
  });
});

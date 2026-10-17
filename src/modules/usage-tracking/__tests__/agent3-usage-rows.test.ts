/**
 * AGENT3-FIRST-CALL-2 — el gasto del Agente 3 se lee igual que el del resto de SellUp:
 *
 *   · la fila lleva el país de la empresa (y sólo cuando se declara: sin él, la fila es
 *     idéntica a la de siempre y el disparador la completa desde el lote);
 *   · «Uso de IA» le da nombre al agente y a cada uno de sus pasos;
 *   · «Presupuesto y créditos» le da un nombre en español a sus operaciones;
 *   · declarar el agente directamente conserva su agente y su paso.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getProviderOperationLabel } from '../../budgets/operation-labels';
import { buildProviderUsageLogInsertPayload } from '../logging';
import {
  AGENT_DIMENSION_LABELS,
  AGENT_STEP_LABELS,
  completeAgentDimensions,
} from '../usage-dimensions';

const SNAPSHOT = { roleKey: 'seller', groupId: null };

describe('país del gasto', () => {
  it('se escribe en mayúsculas cuando se declara', () => {
    const row = buildProviderUsageLogInsertPayload(
      { provider_key: 'anthropic', operation_key: 'account_research', country_code: ' co ' },
      SNAPSHOT,
    );
    assert.equal(row.country_code, 'CO');
  });

  it('sin declararlo, la fila no lo trae (lo completa el disparador desde el lote)', () => {
    const row = buildProviderUsageLogInsertPayload({ provider_key: 'anthropic', operation_key: 'company_classification' }, SNAPSHOT);
    assert.equal('country_code' in row, false);
  });
});

describe('«Uso de IA»', () => {
  it('nombra al agente y a sus cuatro pasos', () => {
    assert.equal(AGENT_DIMENSION_LABELS.agent3, 'Agente 3 · Primera llamada');
    for (const step of ['investigar_empresa', 'noticias', 'talento', 'redactar_llamada']) {
      assert.ok(AGENT_STEP_LABELS[step], step);
    }
  });

  it('una fila que declara su agente y su paso los conserva, aunque su operación sea nueva', () => {
    const dims = completeAgentDimensions({
      providerKey: 'tavily',
      operationKey: 'account_research_news',
      flow: 'agent3_first_call',
      agentKey: 'agent3',
      agentStep: 'noticias',
      runAgentKey: null,
    });
    assert.deepEqual(dims, { agentKey: 'agent3', agentStep: 'noticias' });
  });

  it('la fila se escribe con su agente y su paso', () => {
    const row = buildProviderUsageLogInsertPayload(
      { provider_key: 'anthropic', operation_key: 'first_call_pack', agent_key: 'agent3', agent_step: 'redactar_llamada' },
      SNAPSHOT,
    );
    assert.equal(row.agent_key, 'agent3');
    assert.equal(row.agent_step, 'redactar_llamada');
  });
});

describe('«Presupuesto y créditos»', () => {
  it('las operaciones del agente tienen nombre en español', () => {
    assert.equal(getProviderOperationLabel('anthropic', 'account_research'), 'Investigar la empresa (Agente 3)');
    assert.equal(getProviderOperationLabel('anthropic', 'first_call_pack'), 'Preparar la primera llamada (Agente 3)');
    assert.equal(getProviderOperationLabel('tavily', 'account_research_news'), 'Noticias de la empresa (Agente 3)');
    assert.equal(getProviderOperationLabel('tavily', 'account_research_talent'), 'Empleo y talento de la empresa (Agente 3)');
  });

  it('las que ya tenían nombre no cambian', () => {
    assert.equal(getProviderOperationLabel('tavily', 'web_search'), 'Búsqueda web');
    assert.equal(getProviderOperationLabel('apollo', 'organizations_search'), 'Búsqueda de empresas');
  });
});

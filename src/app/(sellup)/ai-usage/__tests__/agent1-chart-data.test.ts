/**
 * Gráficos del panel del Agente 1 — mapeo de datos: el embudo va en el orden
 * en que ocurre, con las tasas que ya calculó el read model; los desgloses solo
 * enseñan lo que tiene casos. Ninguna cifra se recalcula aquí.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Agent1EffectivenessSummary, OriginBreakdown, RejectionReasonBreakdown } from '@/modules/agent1-effectiveness';
import {
  funnelItems,
  originItems,
  providerBreakdownCostItems,
  rejectionItems,
} from '../agent1-chart-data';

const FUNNEL = {
  batchesCount: 3,
  generatedCandidatesCount: null,
  persistedCandidatesCount: 40,
  pendingCandidatesCount: 10,
  approvedCandidatesCount: 20,
  rejectedCandidatesCount: 8,
  convertedAccountsCount: 5,
  duplicateOrSkippedCount: 0,
  noNewCandidatesBatchesCount: 0,
} as Agent1EffectivenessSummary['funnel'];

const RATES = {
  approvalRate: 0.5,
  rejectionRate: 0.2,
  conversionRate: 0.125,
  pendingRate: 0.25,
} as Agent1EffectivenessSummary['rates'];

const ORIGINS: OriginBreakdown = {
  production: 30,
  smoke_test: 0,
  qa: 4,
  historical_cleanup: 0,
  import: 6,
  synthetic: 0,
  unknown: 0,
};

describe('funnelItems', () => {
  it('va en el orden del embudo, con las cifras y las tasas recibidas', () => {
    assert.deepEqual(
      funnelItems(FUNNEL, RATES).map((item) => [item.label, item.value, item.meta]),
      [
        ['Guardados', 40, undefined],
        ['Por revisar', 10, '25.0%'],
        ['Aprobados', 20, '50.0%'],
        ['Rechazados', 8, '20.0%'],
        ['Ya son cuenta', 5, '12.5%'],
      ],
    );
  });

  it('sin tasa (nada guardado) no se inventa un porcentaje', () => {
    const noRates = { approvalRate: null, rejectionRate: null, conversionRate: null, pendingRate: null } as Agent1EffectivenessSummary['rates'];
    assert.ok(funnelItems(FUNNEL, noRates).every((item) => item.meta === undefined));
  });

  it('la primera fila cambia de nombre en la vista de prospectos reales', () => {
    assert.equal(funnelItems(FUNNEL, RATES, 'Reales')[0].label, 'Reales');
  });
});

describe('originItems', () => {
  it('las búsquedas reales van primero y los orígenes sin candidatos no salen', () => {
    assert.deepEqual(
      originItems(ORIGINS).map((item) => [item.label, item.value, item.tone]),
      [
        ['Búsquedas reales', 30, 'brand'],
        ['Pruebas internas', 4, 'neutral'],
        ['Importación', 6, 'neutral'],
      ],
    );
  });

  it('las búsquedas reales salen aunque estén en cero', () => {
    assert.deepEqual(originItems({ ...ORIGINS, production: 0, qa: 0, import: 0 }).map((item) => item.id), ['production']);
  });

  it('los sin identificar del resumen se enseñan en ámbar si el desglose no los trae', () => {
    const items = originItems(ORIGINS, 3);
    assert.deepEqual(items.at(-1), { id: 'unknown', label: 'Sin identificar', value: 3, tone: 'warning' });
  });

  it('si el desglose ya trae los sin identificar, no se cuentan dos veces', () => {
    const items = originItems({ ...ORIGINS, unknown: 2 }, 3);
    assert.equal(items.filter((item) => item.id === 'unknown').length, 1);
    assert.equal(items.at(-1)?.value, 2);
  });
});

describe('rejectionItems', () => {
  it('solo los motivos con algún caso, con su nombre legible', () => {
    const breakdown = { duplicate: 3, outside_icp: 7, other: 0 } as RejectionReasonBreakdown;
    assert.deepEqual(
      rejectionItems(breakdown).map((item) => [item.label, item.value]),
      [['Duplicado', 3], ['Fuera del perfil de cliente', 7]],
    );
  });

  it('sin rechazos con motivo devuelve una lista vacía', () => {
    assert.deepEqual(rejectionItems({ duplicate: 0 } as RejectionReasonBreakdown), []);
  });
});

describe('providerBreakdownCostItems', () => {
  const row = (overrides: Record<string, unknown>) =>
    ({
      providerKey: 'apollo',
      operationKey: 'search_companies',
      usageLogsCount: 4,
      credits: 4,
      resultsReturned: 100,
      estimatedCostUsd: 2.5,
      missingCostRows: 0,
      zeroCostRows: 0,
      ...overrides,
    }) as Agent1EffectivenessSummary['providerBreakdown'][number];

  it('una barra por consulta con costo, con proveedor y tipo de consulta', () => {
    const items = providerBreakdownCostItems([
      row({}),
      row({ providerKey: 'tavily', operationKey: 'web_search', estimatedCostUsd: 0 }),
      row({ providerKey: 'lusha', operationKey: 'company_search', estimatedCostUsd: 1, missingCostRows: 2 }),
    ]);
    assert.deepEqual(
      items.map((item) => [item.id, item.label, item.value, item.meta]),
      [
        ['apollo::search_companies', 'Apollo · Search companies', 2.5, undefined],
        ['lusha::company_search', 'Lusha · Company search', 1, 'parcial'],
      ],
    );
  });
});

/**
 * Panel de un proveedor — contrato RUNTIME del conjunto: el orquestador, sus
 * seis pestañas y las acciones de servidor que disparan.
 *
 * El panel maneja presupuesto y créditos. Lo que se protege:
 *   - 🔴 abrir el panel carga el detalle UNA vez; las pestañas «Consumo» y
 *     «Logs» no consultan nada hasta que se abren;
 *   - 🔴 sincronizar la cuota llama a la acción una vez, con el proveedor;
 *   - 🔴 eliminar una regla y desconectar exigen confirmación: abrir o cancelar
 *     el diálogo no llama a nada;
 *   - 🔴 si eliminar falla, el motivo se ve y la regla no se da por borrada.
 *
 * Sin red ni base de datos: cada acción de servidor es un espía.
 */

import '@/components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeRow, makeRule, makeUsageLog } from './provider-detail-fixtures';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let ProviderDetailSidepanel: (typeof import('../provider-detail-sidepanel'))['ProviderDetailSidepanel'];

type Call = [name: string, ...args: unknown[]];
const calls: Call[] = [];
const results: Record<string, unknown> = {};
let refreshCount = 0;

const namesOf = (name: string) => calls.filter(([n]) => n === name);

/** Un espía por acción: anota la llamada y devuelve lo que la prueba haya preparado. */
function spy(name: string, fallback: unknown) {
  return async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return name in results ? results[name] : fallback;
  };
}

const OK = { ok: true };

const EMPTY_SNAPSHOT = {
  totalCredits: 0,
  unknownCreditOperations: 0,
  hasUnknownCredits: false,
  totalCostUsd: 0,
  hasUnknownCost: false,
  totalCalls: 0,
  successCalls: 0,
  errorCalls: 0,
  recentLogs: [],
  operationBreakdown: [],
  userConsumption: [],
  filterOptions: null,
};

const DETAIL = {
  usageLogs: [makeUsageLog('u1'), makeUsageLog('u2', { status: 'error' })],
  syncLogs: [],
  providerRules: [makeRule('rule-1')],
  formOptions: { providers: [], roles: [], groups: [], users: [] },
  contactEnrichmentEffectiveness: null,
  aiProviderDetail: null,
  contractPlan: null,
};

// Especificadores RELATIVOS: con los hooks ESM de CI, `mock.module('@/…')` falla.
mock.module('../provider-detail-actions', {
  namedExports: {
    loadProviderDetailForPanel: spy('loadProviderDetailForPanel', DETAIL),
    loadFilteredProviderUsageLogsForPanel: spy('loadFilteredProviderUsageLogsForPanel', {
      ok: true,
      logs: [],
      filterOptions: null,
    }),
    loadProspectingProviderConnectionForPanel: spy('loadProspectingProviderConnectionForPanel', null),
    testProspectingProviderConnectionForPanel: spy('testProspectingProviderConnectionForPanel', OK),
    updateProspectingProviderCredentialForPanel: spy('updateProspectingProviderCredentialForPanel', OK),
    disconnectProspectingProviderForPanel: spy('disconnectProspectingProviderForPanel', OK),
    testAiProviderConnectionForPanel: spy('testAiProviderConnectionForPanel', OK),
    updateAiProviderCredentialForPanel: spy('updateAiProviderCredentialForPanel', OK),
    disconnectAiProviderForPanel: spy('disconnectAiProviderForPanel', OK),
    syncAnthropicModelsForPanel: spy('syncAnthropicModelsForPanel', OK),
    updateAiProviderStatusForPanel: spy('updateAiProviderStatusForPanel', OK),
    updateAiModelStatusForPanel: spy('updateAiModelStatusForPanel', OK),
    addAiModelPricingForPanel: spy('addAiModelPricingForPanel', OK),
    setAiActiveConfigForPanel: spy('setAiActiveConfigForPanel', OK),
  },
});

mock.module('../provider-consumption-actions', {
  namedExports: {
    loadProviderConsumptionForWorkspace: spy('loadProviderConsumptionForWorkspace', {
      ok: true,
      snapshot: EMPTY_SNAPSHOT,
    }),
  },
});

mock.module('../../../../../modules/budgets/index', {
  namedExports: {
    syncProviderQuota: spy('syncProviderQuota', { success: true }),
  },
});

mock.module('../../../../../modules/budgets/rule-actions', {
  namedExports: {
    toggleBudgetRuleStatus: spy('toggleBudgetRuleStatus', { success: true }),
    deleteBudgetRule: spy('deleteBudgetRule', { success: true }),
  },
});

// Los drawers de reglas y de cuota tienen sus propias pruebas: aquí solo
// importa si el panel los abre.
mock.module('../../budget-credits/rules/budget-rules-client', {
  namedExports: {
    CreateDrawer: ({ open }: { open: boolean }) => (open ? <div data-testid="create-rule-drawer" /> : null),
    EditDrawer: ({ open }: { open: boolean }) => (open ? <div data-testid="edit-rule-drawer" /> : null),
  },
});

mock.module('../../budget-credits/provider-allowance-drawer', {
  namedExports: {
    ProviderAllowanceDrawer: ({ open }: { open: boolean }) =>
      open ? <div data-testid="allowance-drawer" /> : null,
  },
});

mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({
      push: () => {},
      replace: () => {},
      prefetch: () => {},
      refresh: () => {
        refreshCount += 1;
      },
    }),
    usePathname: () => '/settings/providers',
  },
});

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ProviderDetailSidepanel } = await import('../provider-detail-sidepanel'));
});

beforeEach(() => {
  calls.length = 0;
  refreshCount = 0;
  for (const key of Object.keys(results)) delete results[key];
});
afterEach(() => cleanup());

type PanelProps = React.ComponentProps<typeof ProviderDetailSidepanel>;

async function openPanel(overrides: Partial<PanelProps> = {}) {
  const tabChanges: string[] = [];
  render(
    <ProviderDetailSidepanel
      provider={makeRow()}
      open
      onClose={() => {}}
      onConfigureAllowance={() => {}}
      onActiveTabChange={(tab) => tabChanges.push(tab)}
      providerConnectionStates={{
        apollo: {
          supported: true,
          credentialsStatus: 'stored',
          connectionStatus: 'connected',
          lastTestedAt: null,
          lastConnectedAt: null,
          lastConnectionError: null,
        } as never,
      }}
      {...overrides}
    />,
  );
  // El detalle llega y la pestaña activa deja de decir «Cargando».
  await waitFor(() => assert.equal(namesOf('loadProviderDetailForPanel').length, 1));
  await waitFor(() => assert.equal(screen.queryByText(/^Cargando/), null));
  return { tabChanges };
}

const tab = (name: RegExp) => screen.getByRole('tab', { name });
const dialog = () => screen.queryByRole('alertdialog', { hidden: true });

function buttonIn(container: HTMLElement, name: string): HTMLElement {
  const match = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === name);
  assert.ok(match, `no hay botón «${name}»`);
  return match;
}

describe('panel del proveedor — carga', () => {
  it('🔴 al abrir carga el detalle una vez, con el proveedor, y nada más', async () => {
    await openPanel();
    assert.deepEqual(calls, [['loadProviderDetailForPanel', 'apollo']]);
  });

  it('abre en «Resumen» con sus seis pestañas', async () => {
    await openPanel();
    assert.deepEqual(
      screen.getAllByRole('tab').map((t) => t.textContent?.trim()),
      ['Resumen', 'Config.', 'Consumo', 'Presupuesto', 'Efectividad', 'Logs'],
    );
    assert.ok(screen.getByRole('heading', { name: 'Salud del proveedor' }));
  });

  it('respeta la pestaña de entrada', async () => {
    await openPanel({ initialTab: 'presupuesto' });
    assert.ok(screen.getByRole('heading', { name: 'Cuota del proveedor' }));
  });

  it('🔴 «Consumo» consulta solo cuando se abre, con el mes actual', async () => {
    const { tabChanges } = await openPanel();
    assert.equal(namesOf('loadProviderConsumptionForWorkspace').length, 0);
    fireEvent.click(tab(/Consumo/));
    await waitFor(() => assert.equal(namesOf('loadProviderConsumptionForWorkspace').length, 1));
    assert.deepEqual(namesOf('loadProviderConsumptionForWorkspace')[0], [
      'loadProviderConsumptionForWorkspace',
      'apollo',
      { period: 'current_month' },
    ]);
    assert.deepEqual(tabChanges, ['consumo']);
    await waitFor(() => assert.ok(screen.getByText('Sin consumo registrado')));
  });

  it('🔴 «Logs» consulta solo cuando se abre, sin filtros', async () => {
    await openPanel();
    assert.equal(namesOf('loadFilteredProviderUsageLogsForPanel').length, 0);
    fireEvent.click(tab(/Logs/));
    await waitFor(() => assert.equal(namesOf('loadFilteredProviderUsageLogsForPanel').length, 1));
    assert.deepEqual(namesOf('loadFilteredProviderUsageLogsForPanel')[0], [
      'loadFilteredProviderUsageLogsForPanel',
      'apollo',
      {},
    ]);
  });

  it('un fallo al cargar el consumo se contiene y deja reintentar', async () => {
    results.loadProviderConsumptionForWorkspace = { ok: false, errorStage: 'provider_stats', errorCode: null };
    await openPanel({ initialTab: 'consumo' });
    await waitFor(() => assert.ok(screen.getByText('No fue posible cargar el consumo de este proveedor.')));
    assert.ok(screen.getByText('No se pudo cargar: Métricas de consumo'));
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => assert.equal(namesOf('loadProviderConsumptionForWorkspace').length, 2));
  });
});

describe('panel del proveedor — presupuesto', () => {
  it('🔴 «Sincronizar con API» llama a la acción una vez, con el proveedor', async () => {
    await openPanel({ initialTab: 'presupuesto' });
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar con API' }));
    await waitFor(() => assert.equal(namesOf('syncProviderQuota').length, 1));
    assert.deepEqual(namesOf('syncProviderQuota')[0], ['syncProviderQuota', 'apollo']);
    await waitFor(() => assert.ok(screen.getByText('Cuota sincronizada con la API del proveedor.')));
    // Tras sincronizar se recarga el detalle del panel y la página.
    assert.equal(namesOf('loadProviderDetailForPanel').length, 2);
    assert.equal(refreshCount, 1);
  });

  it('si la sincronización falla lo dice y no recarga', async () => {
    results.syncProviderQuota = { success: false, error: 'HTTP 429' };
    await openPanel({ initialTab: 'presupuesto' });
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar con API' }));
    await waitFor(() => assert.ok(screen.getByText('HTTP 429')));
    assert.equal(namesOf('loadProviderDetailForPanel').length, 1);
    assert.equal(refreshCount, 0);
  });

  it('«Editar cuota» abre el drawer de la cuota, sin llamar a nada', async () => {
    await openPanel({ initialTab: 'presupuesto' });
    fireEvent.click(screen.getByRole('button', { name: 'Editar cuota manual' }));
    assert.ok(screen.getByTestId('allowance-drawer'));
    assert.equal(calls.length, 1);
  });

  it('🔴 la papelera de una regla abre la confirmación: NO elimina', async () => {
    await openPanel({ initialTab: 'presupuesto' });
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar regla' }));
    assert.ok(dialog(), 'debe abrir el diálogo');
    assert.equal(namesOf('deleteBudgetRule').length, 0);
  });

  it('🔴 cancelar la confirmación no elimina', async () => {
    await openPanel({ initialTab: 'presupuesto' });
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar regla' }));
    fireEvent.click(buttonIn(dialog()!, 'Cancelar'));
    await waitFor(() => assert.equal(dialog(), null));
    assert.equal(namesOf('deleteBudgetRule').length, 0);
  });

  it('🔴 solo confirmar elimina: una vez, esa regla, y recarga el detalle', async () => {
    await openPanel({ initialTab: 'presupuesto' });
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar regla' }));
    fireEvent.click(buttonIn(dialog()!, 'Eliminar regla'));
    await waitFor(() => assert.equal(namesOf('deleteBudgetRule').length, 1));
    assert.deepEqual(namesOf('deleteBudgetRule')[0], ['deleteBudgetRule', 'rule-1']);
    await waitFor(() => assert.equal(dialog(), null));
    assert.equal(namesOf('loadProviderDetailForPanel').length, 2);
  });

  it('🔴 si eliminar falla, el motivo se ve, el diálogo sigue abierto y no se recarga', async () => {
    results.deleteBudgetRule = { success: false, error: 'No autorizado' };
    await openPanel({ initialTab: 'presupuesto' });
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar regla' }));
    fireEvent.click(buttonIn(dialog()!, 'Eliminar regla'));
    await waitFor(() => assert.match(dialog()?.textContent ?? '', /No autorizado/));
    assert.equal(namesOf('loadProviderDetailForPanel').length, 1);
  });

  it('activar o desactivar una regla llama a la acción con el estado contrario', async () => {
    await openPanel({ initialTab: 'presupuesto' });
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar regla' }));
    await waitFor(() => assert.equal(namesOf('toggleBudgetRuleStatus').length, 1));
    assert.deepEqual(namesOf('toggleBudgetRuleStatus')[0], ['toggleBudgetRuleStatus', 'rule-1', false]);
  });

  it('«Crear regla» y «Editar regla» abren su drawer', async () => {
    await openPanel({ initialTab: 'presupuesto' });
    fireEvent.click(screen.getByRole('button', { name: 'Crear regla' }));
    assert.ok(screen.getByTestId('create-rule-drawer'));
    fireEvent.click(screen.getByRole('button', { name: 'Editar regla' }));
    assert.ok(screen.getByTestId('edit-rule-drawer'));
  });
});

describe('panel del proveedor — conexión', () => {
  it('🔴 «Desconectar» pide confirmación: abrir y cancelar no desconectan', async () => {
    await openPanel({ initialTab: 'configuracion' });
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
    assert.ok(dialog(), 'debe abrir el diálogo');
    assert.equal(namesOf('disconnectProspectingProviderForPanel').length, 0);
    fireEvent.click(buttonIn(dialog()!, 'Cancelar'));
    await waitFor(() => assert.equal(dialog(), null));
    assert.equal(namesOf('disconnectProspectingProviderForPanel').length, 0);
  });

  it('🔴 confirmar desconecta una vez, ese proveedor', async () => {
    await openPanel({ initialTab: 'configuracion' });
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
    fireEvent.click(buttonIn(dialog()!, 'Confirmar desconexión'));
    await waitFor(() => assert.equal(namesOf('disconnectProspectingProviderForPanel').length, 1));
    assert.deepEqual(namesOf('disconnectProspectingProviderForPanel')[0], [
      'disconnectProspectingProviderForPanel',
      'apollo',
    ]);
    await waitFor(() => assert.equal(dialog(), null));
  });

  it('«Probar conexión» llama a la prueba del proveedor', async () => {
    await openPanel({ initialTab: 'configuracion' });
    fireEvent.click(screen.getByRole('button', { name: 'Probar conexión' }));
    await waitFor(() => assert.equal(namesOf('testProspectingProviderConnectionForPanel').length, 1));
    assert.deepEqual(namesOf('testProspectingProviderConnectionForPanel')[0], [
      'testProspectingProviderConnectionForPanel',
      'apollo',
    ]);
  });

  it('🔴 guardar la API key manda la clave sin espacios y limpia el campo', async () => {
    await openPanel({ initialTab: 'configuracion' });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar API key' }));
    const input = screen.getByLabelText('Nueva API key') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  clave-de-prueba  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar API key' }));
    await waitFor(() => assert.equal(namesOf('updateProspectingProviderCredentialForPanel').length, 1));
    assert.deepEqual(namesOf('updateProspectingProviderCredentialForPanel')[0], [
      'updateProspectingProviderCredentialForPanel',
      'apollo',
      'clave-de-prueba',
    ]);
    await waitFor(() => assert.equal(screen.queryByLabelText('Nueva API key'), null));
  });
});

describe('panel del proveedor — efectividad', () => {
  it('con fallos recientes ofrece revisar los logs y lleva a esa pestaña', async () => {
    const { tabChanges } = await openPanel({ initialTab: 'efectividad' });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar logs' }));
    assert.deepEqual(tabChanges, ['logs']);
    await waitFor(() => assert.ok(screen.getByRole('heading', { name: 'Sincronización' })));
  });
});

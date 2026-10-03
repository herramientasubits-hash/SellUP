/**
 * Pipeline · filtros — contrato PURO: cada grupo, unión dentro del grupo e
 * intersección entre grupos, umbrales de inactividad, fechas en la zona de la
 * aplicación, nulos (sin país / sin industria), conteos de opciones, el puente
 * con la franja de atención y la ida y vuelta por la URL.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_PIPELINE_FILTERS,
  NONE_VALUE,
  applyPipelineFilters,
  countActiveFilters,
  countFilterOptions,
  isSignalFiltered,
  parsePipelineFilters,
  resolveDatePreset,
  serializePipelineFilters,
  toggleSignalFilter,
  type PipelineFilters,
} from '../pipeline-filters';
import type { PipelineOverviewAccount, PipelineSignal, PipelineSignalId, PipelineStageId } from '../types';

// 1 oct 2026, 09:00 en Bogotá.
const NOW = new Date('2026-10-01T14:00:00Z');

function signal(id: PipelineSignalId): PipelineSignal {
  return { id, label: id, severity: 'notice', stageId: 'enriquecimiento' };
}

function account(
  id: string,
  overrides: Partial<PipelineOverviewAccount> & { signalIds?: PipelineSignalId[] } = {},
): PipelineOverviewAccount {
  const { signalIds = [], ...rest } = overrides;
  return {
    id,
    name: id,
    domain: null,
    countryCode: 'CO',
    industry: 'Tecnología',
    ownerName: 'Ana',
    pipelineStatus: 'new',
    currentStageId: 'enriquecimiento',
    substatusLabel: 'Nueva',
    daysSinceMovement: 1,
    lastMovementAt: '2026-09-30T15:00:00Z',
    createdAt: '2026-09-30T15:00:00Z',
    signals: signalIds.map(signal),
    ...rest,
  };
}

const ACCOUNTS: PipelineOverviewAccount[] = [
  account('a', { daysSinceMovement: 30, lastMovementAt: '2026-09-01T15:00:00Z', createdAt: '2026-09-01T15:00:00Z', signalIds: ['sin_movimiento', 'sin_contactos'] }),
  account('b', { countryCode: 'CL', industry: 'Energía', currentStageId: 'inteligencia', daysSinceMovement: 14, lastMovementAt: '2026-09-17T15:00:00Z', createdAt: '2026-08-10T15:00:00Z', signalIds: ['sin_movimiento', 'corrida_fallida'] }),
  account('c', { countryCode: 'cl', industry: 'Tecnología', currentStageId: 'inteligencia', daysSinceMovement: 7, lastMovementAt: '2026-09-24T15:00:00Z', signalIds: ['sin_movimiento', 'sin_responsable'] }),
  account('d', { countryCode: null, industry: null, currentStageId: 'preparacion', daysSinceMovement: 0, lastMovementAt: '2026-10-01T13:00:00Z', signalIds: ['sin_hubspot'] }),
];

const ids = (filters: Partial<PipelineFilters>) =>
  applyPipelineFilters(ACCOUNTS, { ...EMPTY_PIPELINE_FILTERS, ...filters }, NOW).map((item) => item.id);

describe('Filtros — cada grupo', () => {
  it('sin filtros pasan todas', () => {
    assert.deepEqual(ids({}), ['a', 'b', 'c', 'd']);
    assert.equal(countActiveFilters(EMPTY_PIPELINE_FILTERS), 0);
  });

  it('etapa: varias a la vez son una unión; una etapa sin empresas no añade nada', () => {
    assert.deepEqual(ids({ stages: ['inteligencia'] }), ['b', 'c']);
    assert.deepEqual(ids({ stages: ['enriquecimiento', 'preparacion', 'reunion'] }), ['a', 'd']);
    assert.deepEqual(ids({ stages: ['cierre'] }), []);
  });

  it('país: sin distinguir mayúsculas, y «sin país» para los nulos', () => {
    assert.deepEqual(ids({ countries: ['CL'] }), ['b', 'c']);
    assert.deepEqual(ids({ countries: [NONE_VALUE] }), ['d']);
    assert.deepEqual(ids({ countries: ['CO', NONE_VALUE] }), ['a', 'd']);
  });

  it('industria: unión, y «sin industria» para los nulos', () => {
    assert.deepEqual(ids({ industries: ['Energía'] }), ['b']);
    assert.deepEqual(ids({ industries: ['Energía', NONE_VALUE] }), ['b', 'd']);
  });

  it('inactividad: umbrales 7 / 14 / 21 (o más) y «sin riesgo»', () => {
    assert.deepEqual(ids({ inactivity: 7 }), ['a', 'b', 'c']);
    assert.deepEqual(ids({ inactivity: 14 }), ['a', 'b']);
    assert.deepEqual(ids({ inactivity: 21 }), ['a']);
    assert.deepEqual(ids({ inactivity: 'none' }), ['d']);
  });

  it('fallos de IA y otras señales', () => {
    assert.deepEqual(ids({ aiFailures: ['corrida_fallida'] }), ['b']);
    assert.deepEqual(ids({ signals: ['sin_contactos'] }), ['a']);
    assert.deepEqual(ids({ signals: ['sin_contactos', 'sin_hubspot'] }), ['a', 'd'], 'unión dentro del grupo');
  });

  it('entre grupos es una intersección', () => {
    assert.deepEqual(ids({ countries: ['CL'], inactivity: 14 }), ['b']);
    assert.deepEqual(ids({ stages: ['inteligencia'], signals: ['sin_responsable'] }), ['c']);
    assert.deepEqual(ids({ countries: ['CO'], aiFailures: ['corrida_fallida'] }), []);
  });
});

describe('Filtros — fechas en la zona de la aplicación', () => {
  it('los periodos se resuelven sobre el día de Bogotá', () => {
    assert.deepEqual(resolveDatePreset('hoy', NOW), { from: '2026-10-01', to: '2026-10-01' });
    assert.deepEqual(resolveDatePreset('7d', NOW), { from: '2026-09-25', to: '2026-10-01' });
    assert.deepEqual(resolveDatePreset('30d', NOW), { from: '2026-09-02', to: '2026-10-01' });
    assert.deepEqual(resolveDatePreset('mes', NOW), { from: '2026-10-01', to: '2026-10-01' });
    // A las 03:00 UTC del día 2 en Bogotá todavía es día 1.
    assert.deepEqual(resolveDatePreset('hoy', new Date('2026-10-02T03:00:00Z')), { from: '2026-10-01', to: '2026-10-01' });
  });

  it('por defecto filtra sobre el último movimiento', () => {
    assert.deepEqual(ids({ datePreset: 'hoy' }), ['d']);
    assert.deepEqual(ids({ datePreset: '7d' }), ['d'], 'c se movió el 24 sept: fuera de los últimos 7 días');
    assert.deepEqual(ids({ datePreset: '30d' }), ['b', 'c', 'd']);
  });

  it('se puede cambiar a la entrada al pipeline (created_at)', () => {
    assert.deepEqual(ids({ dateField: 'entrada', datePreset: '7d' }), ['c', 'd']);
    assert.deepEqual(ids({ dateField: 'entrada', from: '2026-08-01', to: '2026-08-31' }), ['b']);
  });

  it('rango libre, inclusive y con extremos abiertos', () => {
    assert.deepEqual(ids({ from: '2026-09-17', to: '2026-09-24' }), ['b', 'c']);
    assert.deepEqual(ids({ from: '2026-09-24' }), ['c', 'd']);
    assert.deepEqual(ids({ to: '2026-09-01' }), ['a']);
  });

  it('un instante de la madrugada UTC cuenta en el día anterior de Bogotá', () => {
    const late = [account('x', { lastMovementAt: '2026-09-25T03:30:00Z' })];
    const on = (day: string) =>
      applyPipelineFilters(late, { ...EMPTY_PIPELINE_FILTERS, from: day, to: day }, NOW).length;
    assert.equal(on('2026-09-24'), 1);
    assert.equal(on('2026-09-25'), 0);
  });

  it('la fecha y la inactividad cuentan como un filtro cada una', () => {
    assert.equal(
      countActiveFilters({ ...EMPTY_PIPELINE_FILTERS, stages: ['inteligencia', 'cierre'], countries: ['CL'], inactivity: 14, datePreset: '30d' }),
      5,
    );
    // Cambiar solo sobre qué fecha se filtra no es un filtro.
    assert.equal(countActiveFilters({ ...EMPTY_PIPELINE_FILTERS, dateField: 'entrada' }), 0);
  });
});

describe('Filtros — opciones y conteos (sobre el total)', () => {
  const options = countFilterOptions(ACCOUNTS);

  it('etapas: las 8, con 0 para las que nadie ha alcanzado', () => {
    assert.deepEqual(
      options.stages.map((option) => [option.value, option.count] as [PipelineStageId, number]),
      [['prospeccion', 0], ['enriquecimiento', 1], ['inteligencia', 2], ['preparacion', 1], ['reunion', 0], ['cotizacion', 0], ['venta_interna', 0], ['cierre', 0]],
    );
  });

  it('países e industrias: solo los presentes, de más a menos, y «sin …» al final', () => {
    assert.deepEqual(options.countries, [
      { value: 'CL', count: 2 },
      { value: 'CO', count: 1 },
      { value: NONE_VALUE, count: 1 },
    ]);
    assert.deepEqual(options.industries, [
      { value: 'Tecnología', count: 2 },
      { value: 'Energía', count: 1 },
      { value: NONE_VALUE, count: 1 },
    ]);
  });

  it('inactividad, fallos de IA (por etapa) y otras señales', () => {
    assert.deepEqual(options.inactivity, [
      { value: 7, count: 3 },
      { value: 14, count: 2 },
      { value: 21, count: 1 },
      { value: 'none', count: 1 },
    ]);
    // Hoy solo existe el fallo del Agente 2A: no se pintan agentes que no existen.
    assert.deepEqual(options.aiFailures, [{ value: 'corrida_fallida', stageId: 'enriquecimiento', count: 1 }]);
    assert.deepEqual(options.signals, [
      { value: 'sin_contactos', count: 1 },
      { value: 'sin_responsable', count: 1 },
      { value: 'sin_hubspot', count: 1 },
      { value: 'decisor_sin_telefono', count: 0 },
    ]);
  });
});

describe('Filtros — la franja de atención es el mismo estado', () => {
  it('«Sin contactos» marca su casilla; pulsar otra vez la quita', () => {
    const on = toggleSignalFilter(EMPTY_PIPELINE_FILTERS, 'sin_contactos');
    assert.deepEqual(on.signals, ['sin_contactos']);
    assert.equal(isSignalFiltered(on, 'sin_contactos'), true);
    assert.deepEqual(toggleSignalFilter(on, 'sin_contactos').signals, []);
  });

  it('«Sin movimiento» es el umbral de 7 días y el fallo de corrida va a los fallos de IA', () => {
    const moved = toggleSignalFilter(EMPTY_PIPELINE_FILTERS, 'sin_movimiento');
    assert.equal(moved.inactivity, 7);
    assert.equal(isSignalFiltered(moved, 'sin_movimiento'), true);
    assert.equal(isSignalFiltered({ ...moved, inactivity: 14 }, 'sin_movimiento'), false);
    assert.equal(toggleSignalFilter(moved, 'sin_movimiento').inactivity, null);

    const failed = toggleSignalFilter(EMPTY_PIPELINE_FILTERS, 'corrida_fallida');
    assert.deepEqual(failed.aiFailures, ['corrida_fallida']);
    assert.deepEqual(failed.signals, []);
  });
});

describe('Filtros — URL', () => {
  const FULL: PipelineFilters = {
    stages: ['enriquecimiento', 'inteligencia'],
    countries: ['CO', 'CL', NONE_VALUE],
    industries: ['Retail / E-commerce', 'Tecnología'],
    inactivity: 14,
    aiFailures: ['corrida_fallida'],
    signals: ['sin_contactos', 'sin_hubspot'],
    dateField: 'entrada',
    datePreset: null,
    from: '2026-09-01',
    to: '2026-09-30',
  };

  it('se escriben compactos y lo que es por defecto no ensucia la URL', () => {
    assert.deepEqual(serializePipelineFilters(EMPTY_PIPELINE_FILTERS), {});
    assert.deepEqual(serializePipelineFilters({ ...EMPTY_PIPELINE_FILTERS, dateField: 'entrada' }), {});
    assert.deepEqual(serializePipelineFilters(FULL), {
      etapa: 'enriquecimiento,inteligencia',
      pais: 'CO,CL,-',
      industria: 'Retail / E-commerce~Tecnología',
      inactividad: '14',
      fallo: '1',
      senal: 'sin_contactos,sin_hubspot',
      fecha: 'entrada',
      desde: '2026-09-01',
      hasta: '2026-09-30',
    });
    assert.deepEqual(serializePipelineFilters({ ...EMPTY_PIPELINE_FILTERS, datePreset: '30d', inactivity: 'none' }), {
      inactividad: 'no',
      periodo: '30d',
    });
  });

  it('ida y vuelta sin pérdidas, también desde URLSearchParams', () => {
    assert.deepEqual(parsePipelineFilters(serializePipelineFilters(FULL)), FULL);
    const preset = { ...EMPTY_PIPELINE_FILTERS, datePreset: '7d' as const, inactivity: 'none' as const };
    assert.deepEqual(parsePipelineFilters(new URLSearchParams(serializePipelineFilters(preset))), preset);
  });

  it('lo desconocido o mal formado se descarta, y convive con view y account', () => {
    assert.deepEqual(
      parsePipelineFilters({
        view: 'tablero',
        account: 'acme',
        etapa: 'inteligencia,inventada',
        pais: 'co',
        inactividad: '9',
        senal: 'sin_contactos,sin_movimiento,otra',
        fallo: 'si',
        periodo: 'siempre',
        desde: '01/09/2026',
        hasta: ['2026-09-30', 'x'],
      }),
      { ...EMPTY_PIPELINE_FILTERS, stages: ['inteligencia'], countries: ['CO'], signals: ['sin_contactos'], to: '2026-09-30' },
    );
  });
});

/**
 * Reglas puras de los filtros y las etiquetas de /ai-usage.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { FilterOptions } from '@/modules/ai-usage/queries';
import {
  applyFilterChange,
  clearedFilters,
  countSecondaryFilters,
  descendantGroupIds,
  describeActiveFilters,
  toQueryString,
  visibleUsers,
  type UsageFilterValues,
} from '../usage-filters-core';
import { formatUsd, humanizeKey, statusPresentation } from '../usage-labels';

const OPTIONS: FilterOptions = {
  providers: ['apollo'],
  agents: [{ key: 'prospect_generation', name: null }],
  statuses: ['success'],
  hasTriggeredBy: true,
  users: [
    { id: 'u1', full_name: 'Ana Ruiz', email: null, role_key: 'seller', group_id: 'g-bogota' },
    { id: 'u2', full_name: null, email: 'luis@ubits.co', role_key: 'admin', group_id: 'g-mx' },
    { id: 'u3', full_name: 'Sin Grupo', email: null, role_key: 'seller', group_id: null },
  ],
  roles: [{ key: 'seller', label: 'Vendedor / BD' }] as FilterOptions['roles'],
  groups: [
    { id: 'g-co', name: 'Colombia', parent_group_id: null, depth: 0 },
    { id: 'g-bogota', name: 'Bogotá', parent_group_id: 'g-co', depth: 1 },
    { id: 'g-mx', name: 'México', parent_group_id: null, depth: 0 },
  ],
  usersScopedToActive: true,
};

const EMPTY: UsageFilterValues = clearedFilters();

describe('descendantGroupIds', () => {
  it('incluye el grupo y todo su subárbol', () => {
    assert.deepEqual([...descendantGroupIds('g-co', OPTIONS.groups)].sort(), ['g-bogota', 'g-co']);
  });

  it('un grupo sin hijos solo se incluye a sí mismo', () => {
    assert.deepEqual([...descendantGroupIds('g-mx', OPTIONS.groups)], ['g-mx']);
  });
});

describe('applyFilterChange', () => {
  it('«all» y vacío quitan el filtro', () => {
    const values = { ...EMPTY, provider: 'apollo' };

    assert.equal(applyFilterChange(values, 'provider', 'all', OPTIONS).provider, '');
    assert.equal(applyFilterChange(values, 'provider', null, OPTIONS).provider, '');
  });

  it('no muta los valores que recibe', () => {
    const values = { ...EMPTY };

    applyFilterChange(values, 'provider', 'apollo', OPTIONS);

    assert.deepEqual(values, EMPTY);
  });

  it('cambiar el rol quita a la persona elegida si no tiene ese rol', () => {
    const next = applyFilterChange({ ...EMPTY, user: 'u2' }, 'role', 'seller', OPTIONS);

    assert.equal(next.role, 'seller');
    assert.equal(next.user, '');
  });

  it('cambiar el rol conserva a la persona si sí lo tiene', () => {
    const next = applyFilterChange({ ...EMPTY, user: 'u1' }, 'role', 'seller', OPTIONS);

    assert.equal(next.user, 'u1');
  });

  it('elegir un grupo padre conserva a quien está en un grupo hijo', () => {
    const next = applyFilterChange({ ...EMPTY, user: 'u1' }, 'groupId', 'g-co', OPTIONS);

    assert.equal(next.user, 'u1');
  });

  it('elegir otro grupo quita a la persona que no pertenece a él', () => {
    const next = applyFilterChange({ ...EMPTY, user: 'u1' }, 'groupId', 'g-mx', OPTIONS);

    assert.equal(next.user, '');
  });

  it('quitar el rol no toca a la persona', () => {
    const next = applyFilterChange({ ...EMPTY, role: 'seller', user: 'u1' }, 'role', 'all', OPTIONS);

    assert.equal(next.user, 'u1');
  });
});

describe('visibleUsers', () => {
  it('sin rol ni grupo se puede elegir a cualquiera', () => {
    assert.equal(visibleUsers(EMPTY, OPTIONS).length, 3);
  });

  it('cruza rol y grupo (con sus descendientes)', () => {
    const users = visibleUsers({ role: 'seller', groupId: 'g-co' }, OPTIONS);

    assert.deepEqual(users.map((user) => user.id), ['u1']);
  });
});

describe('describeActiveFilters / countSecondaryFilters', () => {
  it('sin filtros no describe nada', () => {
    assert.deepEqual(describeActiveFilters(EMPTY, OPTIONS), []);
    assert.equal(countSecondaryFilters(EMPTY), 0);
  });

  it('traduce cada valor a su nombre legible', () => {
    const active = describeActiveFilters(
      { ...EMPTY, period: 'current_month', agent: 'prospect_generation', groupId: 'g-bogota', user: 'u2' },
      OPTIONS,
    );

    assert.deepEqual(active, [
      { key: 'period', label: 'Periodo', value: 'Mes actual' },
      { key: 'agent', label: 'Agente', value: 'Generación de prospectos' },
      { key: 'groupId', label: 'Grupo', value: 'Bogotá' },
      { key: 'user', label: 'Persona', value: 'luis@ubits.co' },
    ]);
  });

  it('el periodo no cuenta como filtro secundario', () => {
    assert.equal(countSecondaryFilters({ ...EMPTY, period: '7d', role: 'seller' }), 1);
  });
});

describe('toQueryString', () => {
  it('escribe los filtros puestos y borra los quitados', () => {
    const query = toQueryString('provider=apollo&status=success', { ...EMPTY, status: 'error' });

    assert.equal(query, 'status=error');
  });

  it('conserva lo que no es un filtro, como la pestaña', () => {
    const query = toQueryString('tab=equipo&provider=apollo', EMPTY);

    assert.equal(query, 'tab=equipo');
  });
});

describe('usage-labels', () => {
  it('un estado conocido tiene nombre y tono; uno desconocido se humaniza en neutro', () => {
    assert.deepEqual(statusPresentation('rate_limited'), { label: 'Demasiadas consultas', type: 'warning' });
    assert.deepEqual(statusPresentation('algo_nuevo'), { label: 'Algo nuevo', type: 'neutral' });
  });

  it('humanizeKey quita los guiones bajos y pone mayúscula inicial', () => {
    assert.equal(humanizeKey('search_companies'), 'Search companies');
  });

  it('formatUsd no deja que un costo diminuto se lea como cero', () => {
    assert.equal(formatUsd(0), '$0.00');
    assert.equal(formatUsd(0.0004), '$0.000400');
    assert.equal(formatUsd(12.345), '$12.35');
    assert.equal(formatUsd(0.0123, 4), '$0.0123');
  });
});

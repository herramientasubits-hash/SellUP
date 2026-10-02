/**
 * Filtro «Equipo» — contrato RUNTIME: es un filtro de la barra de la tabla (no
 * una sección de «Configurar tabla»), dice qué filtra y filtra de verdad por
 * grupo (con subgrupos) o por persona.
 */

import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';

mock.module('next/navigation', {
  namedExports: {
    usePathname: () => '/contacts',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  },
});

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let mod: typeof import('../scope-filters-client');

const OPTIONS: ScopeFilterOptions = {
  users: [
    { id: 'ana', full_name: 'Ana Gómez', email: 'ana@x.co', role_key: 'seller_bd', group_id: 'norte' },
    { id: 'beto', full_name: 'Beto Ruiz', email: 'beto@x.co', role_key: 'seller_bd', group_id: 'norte-a' },
    { id: 'caro', full_name: 'Caro Díaz', email: 'caro@x.co', role_key: 'manager', group_id: 'sur' },
    { id: 'dani', full_name: 'Dani Sin Grupo', email: null, role_key: 'seller_bd', group_id: null },
  ],
  groups: [
    { id: 'norte', name: 'Ventas Norte', parent_group_id: null, depth: 0 },
    { id: 'norte-a', name: 'Norte A', parent_group_id: 'norte', depth: 1 },
    { id: 'sur', name: 'Ventas Sur', parent_group_id: null, depth: 0 },
  ],
  roles: [],
  showScopeFilters: true,
  currentUserId: 'ana',
};

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  mod = await import('../scope-filters-client');
});

afterEach(() => cleanup());

describe('resolveScopeOwnerIds — qué personas entran', () => {
  it('sin selección no filtra', () => {
    assert.equal(mod.resolveScopeOwnerIds(OPTIONS, mod.EMPTY_SCOPE_FILTER), null);
  });

  it('un grupo incluye a la gente de sus subgrupos', () => {
    const ids = mod.resolveScopeOwnerIds(OPTIONS, { userId: '', groupId: 'norte' });
    assert.deepEqual([...(ids ?? [])].sort(), ['ana', 'beto']);
  });

  it('una persona gana sobre el grupo', () => {
    const ids = mod.resolveScopeOwnerIds(OPTIONS, { userId: 'caro', groupId: 'norte' });
    assert.deepEqual([...(ids ?? [])], ['caro']);
  });

  it('🔴 quien solo se ve a sí mismo no filtra por equipo', () => {
    const ids = mod.resolveScopeOwnerIds({ ...OPTIONS, showScopeFilters: false }, { userId: 'caro', groupId: '' });
    assert.equal(ids, null);
  });
});

describe('TeamFilterButton — el botón de la barra', () => {
  const noop = () => {};

  it('sin filtro se llama «Equipo»', () => {
    render(<mod.TeamFilterButton scopeFilterOptions={OPTIONS} value={mod.EMPTY_SCOPE_FILTER} onChange={noop} />);
    assert.ok(screen.getByRole('button', { name: 'Filtrar por equipo' }));
    assert.ok(screen.getByText('Equipo'));
  });

  it('activo dice qué filtra: el grupo o la persona', () => {
    const { rerender } = render(
      <mod.TeamFilterButton scopeFilterOptions={OPTIONS} value={{ userId: '', groupId: 'sur' }} onChange={noop} />,
    );
    assert.ok(screen.getByRole('button', { name: 'Filtro de equipo: Ventas Sur' }));

    rerender(
      <mod.TeamFilterButton scopeFilterOptions={OPTIONS} value={{ userId: 'ana', groupId: '' }} onChange={noop} />,
    );
    assert.ok(screen.getByRole('button', { name: 'Filtro de equipo: Ana Gómez' }));
  });

  it('🔴 a quien no tiene equipo no se le pinta', () => {
    const { container } = render(
      <mod.TeamFilterButton
        scopeFilterOptions={{ ...OPTIONS, showScopeFilters: false }}
        value={mod.EMPTY_SCOPE_FILTER}
        onChange={noop}
      />,
    );
    assert.equal(container.innerHTML, '');
  });
});

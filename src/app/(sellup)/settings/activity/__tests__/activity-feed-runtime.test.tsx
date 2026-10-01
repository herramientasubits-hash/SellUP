/**
 * Actividad de la plataforma — contrato RUNTIME de los filtros.
 *
 * Lo que se protege:
 *   - el filtro por tipo vuelve a pedir la actividad con ESE tipo;
 *   - 🔴 quien no es administrador ni líder no ve el selector de persona;
 *   - el alcance de lo que se ve se explica en la cabecera.
 */

import '../../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityViewerContext, PlatformActivityEvent } from '@/modules/system-status/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let ActivityFeedClient: (typeof import('../activity-feed-client'))['ActivityFeedClient'];

const h = React.createElement;

const requests: Record<string, unknown>[] = [];

// Especificador RELATIVO: con los hooks ESM de CI, `mock.module('@/…')` falla.
mock.module('../../../../../modules/system-status/activity-actions', {
  namedExports: {
    getPlatformActivity: async (filter: Record<string, unknown>) => {
      requests.push(filter);
      return { events: [], hasMore: false };
    },
  },
});

const EVENT = {
  id: 'e1',
  source: 'users',
  label: 'Acceso aprobado',
  description: null,
  created_at: '2026-08-01T15:00:00Z',
  actor: { email: 'ana@ubits.co', full_name: 'Ana Ruiz' },
  target: null,
} as unknown as PlatformActivityEvent;

function context(overrides: Partial<ActivityViewerContext> = {}): ActivityViewerContext {
  return {
    isAdmin: false,
    isManager: false,
    allowedUsers: [{ id: 'u-ana', email: 'ana@ubits.co', full_name: 'Ana Ruiz' }],
    ...overrides,
  } as ActivityViewerContext;
}

function renderFeed(ctx: ActivityViewerContext) {
  return render(h(ActivityFeedClient, { context: ctx, initialEvents: [EVENT], initialHasMore: false }));
}

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ActivityFeedClient } = await import('../activity-feed-client'));
});

beforeEach(() => {
  requests.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('Actividad — filtros', () => {
  it('pinta la actividad inicial y explica el alcance', () => {
    renderFeed(context());

    assert.ok(screen.getByText('Acceso aprobado'));
    assert.ok(screen.getByText(/Ves tu propia actividad\./));
  });

  it('el tipo de actividad es un grupo de opción única con «Todo» puesto', () => {
    renderFeed(context());

    const group = screen.getByRole('radiogroup', { name: 'Filtrar por tipo de actividad' });
    assert.ok(group);
    assert.equal(screen.getByRole('radio', { name: 'Todo' }).getAttribute('aria-checked'), 'true');
  });

  it('elegir un tipo vuelve a pedir la actividad de ese tipo', async () => {
    renderFeed(context());

    fireEvent.click(screen.getByRole('radio', { name: 'Integraciones' }));

    await waitFor(() => assert.equal(requests.length, 1));
    assert.equal(requests[0].source, 'integrations');
    assert.equal(requests[0].offset, 0);
    assert.equal(screen.getByRole('radio', { name: 'Integraciones' }).getAttribute('aria-checked'), 'true');
  });

  it('🔴 sin ser administrador ni líder no hay selector de persona', () => {
    renderFeed(context());

    assert.equal(screen.queryByRole('combobox'), null);
  });

  it('un administrador puede elegir de quién ver la actividad', () => {
    renderFeed(context({ isAdmin: true }));

    const selector = screen.getByRole('combobox');
    assert.match(selector.textContent ?? '', /Todos los usuarios/);
  });
});

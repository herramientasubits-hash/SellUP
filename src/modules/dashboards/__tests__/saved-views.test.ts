// TABLEROS-1 — Vistas guardadas v1 (en el navegador): sólo guardan la pestaña y
// los filtros, se actualizan por nombre y aguantan datos corruptos.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SAVED_VIEWS,
  addSavedView,
  isCurrentView,
  parseSavedViews,
  removeSavedView,
  sanitizeViewQuery,
  serializeSavedViews,
  type SavedDashboardView,
} from '../saved-views';

const NOW = '2026-11-25T17:00:00.000Z';

describe('sanitizeViewQuery', () => {
  it('sólo viajan la pestaña y los filtros de los tableros', () => {
    assert.equal(
      sanitizeViewQuery('?tab=equipo&periodo=last_30&token=secreto&utm_source=x&personas=a,b'),
      'tab=equipo&periodo=last_30&personas=a%2Cb',
    );
  });
});

describe('parseSavedViews', () => {
  it('JSON roto, otra forma o nada: lista vacía (nunca rompe la página)', () => {
    assert.deepEqual(parseSavedViews(null), []);
    assert.deepEqual(parseSavedViews('{no es json'), []);
    assert.deepEqual(parseSavedViews('{"a":1}'), []);
    assert.deepEqual(parseSavedViews('[{"id":1}]'), []);
  });

  it('ida y vuelta con serializeSavedViews', () => {
    const views: SavedDashboardView[] = [{ id: '1', name: 'Mi equipo', query: 'periodo=last_30', createdAt: NOW }];
    assert.deepEqual(parseSavedViews(serializeSavedViews(views)), views);
  });
});

describe('addSavedView / removeSavedView', () => {
  it('pide un nombre', () => {
    assert.deepEqual(addSavedView([], { name: '   ', query: '', id: '1', now: NOW }), { ok: false, reason: 'empty_name' });
  });

  it('el mismo nombre (sin distinguir mayúsculas) ACTUALIZA la vista y conserva su id', () => {
    const first = addSavedView([], { name: 'Equipo CO', query: 'periodo=last_7', id: '1', now: NOW });
    assert.ok(first.ok);
    const second = addSavedView(first.views, { name: 'equipo co', query: 'periodo=last_30', id: '2', now: NOW });
    assert.ok(second.ok);
    assert.equal(second.views.length, 1);
    assert.equal(second.views[0].id, '1');
    assert.equal(second.views[0].query, 'periodo=last_30');
  });

  it(`hay un tope de ${MAX_SAVED_VIEWS} vistas`, () => {
    let views: SavedDashboardView[] = [];
    for (let i = 0; i < MAX_SAVED_VIEWS; i++) {
      const result = addSavedView(views, { name: `Vista ${i}`, query: '', id: String(i), now: NOW });
      assert.ok(result.ok);
      views = result.views;
    }
    assert.deepEqual(addSavedView(views, { name: 'Una más', query: '', id: 'x', now: NOW }), {
      ok: false,
      reason: 'limit_reached',
    });
    assert.equal(removeSavedView(views, '0').length, MAX_SAVED_VIEWS - 1);
  });
});

describe('isCurrentView', () => {
  it('compara sin importar el orden de los parámetros ni lo que no es filtro', () => {
    const view: SavedDashboardView = { id: '1', name: 'X', query: 'periodo=last_30&tab=empresas', createdAt: NOW };
    assert.equal(isCurrentView(view, 'tab=empresas&periodo=last_30&utm=1'), true);
    assert.equal(isCurrentView(view, 'tab=contactos&periodo=last_30'), false);
  });
});

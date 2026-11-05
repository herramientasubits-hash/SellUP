import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_VISIBLE_SINCE, clampToVisibleSince, parseVisibleSince } from '../visible-since';

describe('visible-since — corte de visibilidad', () => {
  it('por defecto corta en la limpieza de entrega', () => {
    assert.equal(parseVisibleSince(undefined), DEFAULT_VISIBLE_SINCE);
    assert.equal(parseVisibleSince('  '), DEFAULT_VISIBLE_SINCE);
  });

  it('"off" lo apaga y una fecha válida lo cambia', () => {
    assert.equal(parseVisibleSince('OFF'), null);
    assert.equal(parseVisibleSince('2026-12-01T00:00:00Z'), '2026-12-01T00:00:00.000Z');
  });

  it('un valor inválido no muestra de más: cae al corte por defecto', () => {
    assert.equal(parseVisibleSince('ayer'), DEFAULT_VISIBLE_SINCE);
  });

  it('el «desde» de la pantalla nunca queda antes del corte', () => {
    const cut = '2026-11-05T21:00:00.000Z';
    assert.equal(clampToVisibleSince(null, cut), cut);
    assert.equal(clampToVisibleSince('2026-10-01T00:00:00.000Z', cut), cut);
    assert.equal(clampToVisibleSince('2026-11-20T00:00:00.000Z', cut), '2026-11-20T00:00:00.000Z');
  });

  it('sin corte respeta lo que pidió la pantalla', () => {
    assert.equal(clampToVisibleSince(null, null), null);
    assert.equal(clampToVisibleSince('2026-10-01T00:00:00.000Z', null), '2026-10-01T00:00:00.000Z');
  });
});

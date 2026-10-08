/**
 * Regla de plataforma: todo texto cortado con «…» muestra su texto completo en tooltip.
 * Detector puro: jsdom no calcula layout, así que se simulan los tamaños de scroll.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  ELLIPSIS_TOOLTIP_OPT_OUT_ATTRIBUTE,
  ellipsisTooltipText,
  findEllipsizedElement,
  isEllipsized,
  type EllipsisStyle,
} from '../ellipsis-tooltip';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const doc = dom.window.document;

const TRUNCATE: EllipsisStyle = { textOverflow: 'ellipsis', overflowX: 'hidden', overflowY: 'hidden', lineClamp: 'none' };
const CLAMP: EllipsisStyle = { textOverflow: 'clip', overflowX: 'hidden', overflowY: 'hidden', lineClamp: '2' };
const PLAIN: EllipsisStyle = { textOverflow: 'clip', overflowX: 'visible', overflowY: 'visible', lineClamp: 'none' };

function sized(el: Element, sizes: { scrollWidth?: number; clientWidth?: number; scrollHeight?: number; clientHeight?: number }): void {
  for (const [key, value] of Object.entries(sizes)) Object.defineProperty(el, key, { value, configurable: true });
}

function make(html: string): HTMLElement {
  doc.body.innerHTML = '';
  const host = doc.createElement('div');
  host.innerHTML = html;
  doc.body.appendChild(host);
  return host;
}

describe('isEllipsized', () => {
  it('una línea: true sólo si el contenido no cabe', () => {
    const el = doc.createElement('span');
    sized(el, { scrollWidth: 300, clientWidth: 120 });
    assert.equal(isEllipsized(el, () => TRUNCATE), true);
    sized(el, { scrollWidth: 120, clientWidth: 120 });
    assert.equal(isEllipsized(el, () => TRUNCATE), false);
  });

  it('line-clamp: true sólo si el contenido es más alto que la caja', () => {
    const el = doc.createElement('p');
    sized(el, { scrollHeight: 80, clientHeight: 40 });
    assert.equal(isEllipsized(el, () => CLAMP), true);
    sized(el, { scrollHeight: 40, clientHeight: 40 });
    assert.equal(isEllipsized(el, () => CLAMP), false);
  });

  it('sin overflow oculto no hay puntos suspensivos aunque el texto sea ancho', () => {
    const el = doc.createElement('span');
    sized(el, { scrollWidth: 300, clientWidth: 120 });
    assert.equal(isEllipsized(el, () => PLAIN), false);
  });
});

describe('findEllipsizedElement', () => {
  it('sube desde un hijo hasta el contenedor recortado', () => {
    const host = make('<div id="cell"><b id="inner">Almacenes Simán, S.A. de C.V.</b></div>');
    const cell = host.querySelector('#cell')!;
    const inner = host.querySelector('#inner')!;
    sized(cell, { scrollWidth: 400, clientWidth: 100 });
    const read = (el: Element): EllipsisStyle => (el === cell ? TRUNCATE : PLAIN);
    assert.equal(findEllipsizedElement(inner, read), cell);
  });

  it('devuelve null cuando el texto cabe', () => {
    const host = make('<div id="cell">Corto</div>');
    const cell = host.querySelector('#cell')!;
    sized(cell, { scrollWidth: 50, clientWidth: 100 });
    assert.equal(findEllipsizedElement(cell, () => TRUNCATE), null);
  });

  it('el más cercano gana: una etiqueta recortada dentro de una celda recortada', () => {
    const host = make('<div id="cell"><span id="badge">Etiqueta larga</span></div>');
    const cell = host.querySelector('#cell')!;
    const badge = host.querySelector('#badge')!;
    sized(cell, { scrollWidth: 400, clientWidth: 100 });
    sized(badge, { scrollWidth: 200, clientWidth: 80 });
    assert.equal(findEllipsizedElement(badge, () => TRUNCATE), badge);
  });

  it('respeta la exclusión explícita', () => {
    const host = make(`<div ${ELLIPSIS_TOOLTIP_OPT_OUT_ATTRIBUTE}><span id="x">Texto largo</span></div>`);
    const x = host.querySelector('#x')!;
    sized(x, { scrollWidth: 400, clientWidth: 100 });
    assert.equal(findEllipsizedElement(x, () => TRUNCATE), null);
  });

  it('no duplica un tooltip propio ni toca inputs', () => {
    const host = make('<button data-slot="tooltip-trigger"><span id="a">Texto largo</span></button><input id="b" value="largo">');
    const a = host.querySelector('#a')!;
    const b = host.querySelector('#b')!;
    sized(a, { scrollWidth: 400, clientWidth: 100 });
    sized(b, { scrollWidth: 400, clientWidth: 100 });
    assert.equal(findEllipsizedElement(a, () => TRUNCATE), null);
    assert.equal(findEllipsizedElement(b, () => TRUNCATE), null);
  });

  it('no sube más allá del body', () => {
    doc.body.innerHTML = '';
    const el = doc.createElement('span');
    doc.body.appendChild(el);
    sized(doc.body, { scrollWidth: 999, clientWidth: 100 });
    assert.equal(findEllipsizedElement(el, () => TRUNCATE), null);
  });
});

describe('ellipsisTooltipText', () => {
  it('texto completo con espacios normalizados', () => {
    const host = make('<div id="t">  Super   Repuestos,\n S.A. de C.V.  </div>');
    assert.equal(ellipsisTooltipText(host.querySelector('#t')!), 'Super Repuestos, S.A. de C.V.');
  });

  it('prefiere el title propio y el que se guardó mientras el tooltip está abierto', () => {
    const host = make('<div id="a" title="Nombre oficial">Corto…</div><div id="b" data-ellipsis-title="Guardado">x</div>');
    assert.equal(ellipsisTooltipText(host.querySelector('#a')!), 'Nombre oficial');
    assert.equal(ellipsisTooltipText(host.querySelector('#b')!), 'Guardado');
  });

  it('vacío no muestra nada; muy largo se acota', () => {
    const host = make('<div id="e">   </div>');
    assert.equal(ellipsisTooltipText(host.querySelector('#e')!), null);
    const long = doc.createElement('div');
    long.textContent = 'a'.repeat(1000);
    const text = ellipsisTooltipText(long)!;
    assert.equal(text.length, 601);
    assert.ok(text.endsWith('…'));
  });
});

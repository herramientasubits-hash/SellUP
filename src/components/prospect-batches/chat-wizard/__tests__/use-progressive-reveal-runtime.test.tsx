/**
 * Rumbo se quedaba en «Escribiendo…» para siempre (Prod 11 y 12-11): un redibujo
 * a mitad de la aparición de mensajes cancelaba el temporizador y nadie lo
 * volvía a programar. Se prueba con el hook real y relojes falsos.
 */
import '@/components/settings/__tests__/jsdom-bootstrap';

import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let renderHook: (typeof import('@testing-library/react'))['renderHook'];
let act: (typeof import('@testing-library/react'))['act'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let hook: typeof import('../use-progressive-reveal');

before(async () => {
  ({ renderHook, act, cleanup } = await import('@testing-library/react'));
  hook = await import('../use-progressive-reveal');
});
beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => {
  cleanup();
  mock.timers.reset();
});

const tick = (ms: number) => act(() => mock.timers.tick(ms));
/** Deja correr todos los pasos (cada uno programa el siguiente al renderizar). */
const settle = () => {
  for (let i = 0; i < 12; i++) tick(450);
};

describe('useProgressiveReveal', () => {
  it('muestra los mensajes de a uno y termina sin «escribiendo»', () => {
    const { result } = renderHook(({ count }) => hook.useProgressiveReveal(count), { initialProps: { count: 3 } });
    assert.deepEqual(result.current, { visibleCount: 0, isTyping: true });
    tick(400);
    assert.equal(result.current.visibleCount, 1);
    tick(450);
    tick(450);
    assert.deepEqual(result.current, { visibleCount: 3, isTyping: false });
  });

  it('🔴 un redibujo a mitad de camino (mismo número de mensajes) NO lo traba', () => {
    const { result, rerender } = renderHook(({ count, tag }) => (void tag, hook.useProgressiveReveal(count)), {
      initialProps: { count: 3, tag: 0 },
    });
    tick(400);
    assert.equal(result.current.visibleCount, 1);
    // Llega un dato y el estado cambia sin agregar mensajes, varias veces.
    for (let i = 1; i <= 5; i++) {
      rerender({ count: 3, tag: i });
      tick(100);
    }
    settle();
    assert.deepEqual(result.current, { visibleCount: 3, isTyping: false });
  });

  it('al reiniciar (menos mensajes) muestra los que quedan y los nuevos vuelven a aparecer de a uno', () => {
    const { result, rerender } = renderHook(({ count }) => hook.useProgressiveReveal(count), { initialProps: { count: 2 } });
    settle();
    assert.equal(result.current.visibleCount, 2);
    rerender({ count: 1 });
    assert.deepEqual(result.current, { visibleCount: 1, isTyping: false });
    rerender({ count: 2 });
    assert.equal(result.current.isTyping, true);
    tick(450);
    assert.deepEqual(result.current, { visibleCount: 2, isTyping: false });
  });

  it('avisa cada mensaje que aparece (para el sonido)', () => {
    const seen: number[] = [];
    renderHook(() => hook.useProgressiveReveal(2, (index) => seen.push(index)));
    settle();
    assert.deepEqual(seen, [0, 1]);
  });
});

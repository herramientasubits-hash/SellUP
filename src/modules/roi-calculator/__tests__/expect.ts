/**
 * Un `expect` minimo sobre `node:assert`.
 *
 * Las pruebas vienen de la calculadora original, que corria con vitest. SellUP
 * prueba con `node:test`; este adaptador deja las aserciones casi literales y
 * cubre solo los comparadores que esas pruebas usan.
 */

import assert from 'node:assert/strict';

function comparadores(actual: unknown, mensaje?: string, negado = false) {
  const comprobar = (ok: boolean, descripcion: string) => {
    if (ok === negado) {
      assert.fail(
        mensaje ??
          `Se esperaba que ${JSON.stringify(actual)} ${negado ? 'no ' : ''}${descripcion}`,
      );
    }
  };
  const esIgual = (esperado: unknown) => {
    try {
      assert.deepStrictEqual(actual, esperado);
      return true;
    } catch {
      return false;
    }
  };
  const contiene = (objeto: unknown, patron: unknown): boolean => {
    if (typeof patron !== 'object' || patron === null) return Object.is(objeto, patron);
    if (typeof objeto !== 'object' || objeto === null) return false;
    return Object.entries(patron).every(([clave, valor]) =>
      contiene((objeto as Record<string, unknown>)[clave], valor),
    );
  };

  return {
    toBe: (esperado: unknown) => comprobar(Object.is(actual, esperado), `sea ${JSON.stringify(esperado)}`),
    toEqual: (esperado: unknown) => comprobar(esIgual(esperado), `sea igual a ${JSON.stringify(esperado)}`),
    toMatchObject: (esperado: object) =>
      comprobar(contiene(actual, esperado), `contenga ${JSON.stringify(esperado)}`),
    toBeNull: () => comprobar(actual === null, 'sea null'),
    toBeUndefined: () => comprobar(actual === undefined, 'sea undefined'),
    toBeCloseTo: (esperado: number, decimales = 2) =>
      comprobar(
        Math.abs((actual as number) - esperado) < 10 ** -decimales / 2,
        `se acerque a ${esperado}`,
      ),
    toBeGreaterThan: (n: number) => comprobar((actual as number) > n, `sea mayor que ${n}`),
    toBeLessThan: (n: number) => comprobar((actual as number) < n, `sea menor que ${n}`),
    toBeLessThanOrEqual: (n: number) => comprobar((actual as number) <= n, `sea <= ${n}`),
    toHaveLength: (n: number) =>
      comprobar((actual as { length: number }).length === n, `tenga largo ${n}`),
    toContain: (item: unknown) =>
      comprobar(
        typeof actual === 'string'
          ? actual.includes(item as string)
          : (actual as unknown[]).includes(item),
        `contenga ${JSON.stringify(item)}`,
      ),
    toMatch: (patron: RegExp | string) =>
      comprobar(
        typeof patron === 'string'
          ? (actual as string).includes(patron)
          : patron.test(actual as string),
        `cumpla ${String(patron)}`,
      ),
  };
}

export function expect(actual: unknown, mensaje?: string) {
  return { ...comparadores(actual, mensaje), not: comparadores(actual, mensaje, true) };
}

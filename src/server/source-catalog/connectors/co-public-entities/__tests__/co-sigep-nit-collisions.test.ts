/**
 * Choques de NIT en el SIGEP II: dos entidades «cabeza» distintas con el mismo NIT.
 * Puro: sin red ni base. Los casos replican los 12 choques medidos el 16-10-2026.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSigepNitCollisions,
  sigepNameMatchesChip,
  type SigepNitFact,
} from '../co-sigep-nit-collisions';

const fact = (nit: string, nameKey: string, workers: number, head = true): SigepNitFact => ({ nit, nameKey, head, workers });
const chipMaps = (entries: Array<[string, string]>) => ({
  chipNameByNit: new Map(entries),
  chipNitsByName: new Map(entries.map(([nit, name]) => [name, new Set([nit])] as const)),
});

describe('sigepNameMatchesChip', () => {
  it('el nombre corto del CHIP cabe en el oficial del SIGEP (y al revés)', () => {
    assert.equal(sigepNameMatchesChip('ALCALDIA DE MAICAO', 'MAICAO'), true);
    assert.equal(sigepNameMatchesChip('GOBERNACION DE CASANARE', 'DEPARTAMENTO DE CASANARE'), true);
    assert.equal(sigepNameMatchesChip('ALCALDIA DISTRITAL ESPECIAL TURISTICO Y CULTURAL DE RIOHACHA', 'RIOHACHA'), true);
    assert.equal(sigepNameMatchesChip('MINISTERIO DEL TRABAJO', 'MINISTERIO DEL TRABAJO'), true);
  });

  it('compartir una palabra suelta no basta: «SAN» no hace iguales a San Juanito y San Martín', () => {
    assert.equal(sigepNameMatchesChip('ALCALDIA DE SAN MARTIN DE LOS LLANOS META', 'SAN JUANITO'), false);
    assert.equal(sigepNameMatchesChip('ALCALDIA DE COLOMBIA', 'RIOHACHA'), false);
    assert.equal(sigepNameMatchesChip('MINISTERIO DE SALUD Y PROTECCION SOCIAL', 'MINISTERIO DEL TRABAJO'), false);
  });

  it('la clase de entidad por sí sola no identifica a nadie', () => {
    assert.equal(sigepNameMatchesChip('ALCALDIA DE X', 'ALCALDIA DE Y'), false);
    assert.equal(sigepNameMatchesChip('', 'MAICAO'), false);
  });
});

describe('resolveSigepNitCollisions', () => {
  it('se queda el nombre que concuerda con el CHIP y el otro pasa a su NIT si el CHIP lo conoce', () => {
    const facts = [
      fact('830115226', 'MINISTERIO DE SALUD Y PROTECCION SOCIAL', 559),
      fact('830115226', 'MINISTERIO DEL TRABAJO', 1881),
    ];
    const maps = chipMaps([
      ['830115226', 'MINISTERIO DEL TRABAJO'],
      ['900474727', 'MINISTERIO DE SALUD Y PROTECCION SOCIAL'],
    ]);
    const { assignment, collisions } = resolveSigepNitCollisions({ facts, ...maps });
    assert.deepEqual(assignment, ['900474727', '830115226']);
    assert.equal(collisions.length, 1);
  });

  it('el destino con filas propias en el SIGEP NO recibe las de la ajena (evita contar dos veces)', () => {
    const facts = [
      fact('892099216', 'GOBERNACION DE CASANARE', 250),
      fact('892099216', 'CORPORACION AUTONOMA REGIONAL DE LA ORINOQUIA', 61),
      fact('832000283', 'CORPORACION AUTONOMA REGIONAL DE LA ORINOQUIA', 61),
    ];
    const maps = chipMaps([
      ['892099216', 'DEPARTAMENTO DE CASANARE'],
      ['832000283', 'CORPORACION AUTONOMA REGIONAL DE LA ORINOQUIA'],
    ]);
    const { assignment, collisions } = resolveSigepNitCollisions({ facts, ...maps });
    assert.deepEqual(assignment, ['892099216', null, '832000283']);
    const [report] = collisions;
    assert.equal(report.resolution, 'resuelto');
    if (report.resolution === 'resuelto') assert.equal(report.dropped[0]?.reason, 'destino_ya_tiene_sigep');
  });

  it('sin dueño claro NO se toca nada y se informa (sin CHIP, ninguna o varias concuerdan)', () => {
    const noChip = resolveSigepNitCollisions({
      facts: [fact('1', 'ALCALDIA DE A', 5), fact('1', 'ALCALDIA DE B', 5)],
      chipNameByNit: new Map(),
      chipNitsByName: new Map(),
    });
    assert.deepEqual(noChip.assignment, ['1', '1']);
    assert.deepEqual(noChip.collisions.map((c) => c.resolution === 'sin_resolver' && c.reason), ['sin_nombre_chip']);

    const none = resolveSigepNitCollisions({
      facts: [fact('1', 'ALCALDIA DE A', 5), fact('1', 'ALCALDIA DE B', 5)],
      ...chipMaps([['1', 'C']]),
    });
    assert.deepEqual(none.assignment, ['1', '1']);
    assert.deepEqual(none.collisions.map((c) => c.resolution === 'sin_resolver' && c.reason), ['ninguna_concuerda']);

    const both = resolveSigepNitCollisions({
      facts: [fact('1', 'ALCALDIA DE RIOHACHA', 5), fact('1', 'ALCALDIA DISTRITAL DE RIOHACHA', 5)],
      ...chipMaps([['1', 'RIOHACHA']]),
    });
    assert.deepEqual(both.assignment, ['1', '1']);
    assert.deepEqual(both.collisions.map((c) => c.resolution === 'sin_resolver' && c.reason), ['varias_concuerdan']);
  });

  it('una sola cabeza (concejo/personería/fuerzas bajo un ministerio) no es un choque', () => {
    const facts = [
      fact('899999003', 'MINISTERIO DE DEFENSA NACIONAL', 3000),
      fact('899999003', 'ARMADA NACIONAL', 30000, false),
      fact('899999003', 'FUERZA AEROESPACIAL COLOMBIANA', 9000, false),
    ];
    const { assignment, collisions } = resolveSigepNitCollisions({ facts, ...chipMaps([['899999003', 'MINISTERIO DE DEFENSA NACIONAL']]) });
    assert.deepEqual(assignment, ['899999003', '899999003', '899999003']);
    assert.deepEqual(collisions, []);
  });
});

describe('correcciones manuales (errores de captura verificados)', () => {
  it('el Ejército capturado con el NIT de Superservicios sale de esa fila', () => {
    const facts = [
      fact('800250984', 'SUPERINTENDENCIA DE SERVICIOS PUBLICOS DOMICILIARIOS', 824),
      fact('800250984', 'EJERCITO NACIONAL DE COLOMBIA', 4497, false),
    ];
    const { assignment, collisions } = resolveSigepNitCollisions({
      facts,
      ...chipMaps([['800250984', 'SUPERINTENDENCIA DE SERVICIOS PUBLICOS DOMICILIARIOS']]),
    });
    assert.deepEqual(assignment, ['800250984', null]);
    assert.equal(collisions.length, 1);
    const [report] = collisions;
    assert.equal(report.resolution, 'correccion_manual');
    if (report.resolution === 'correccion_manual') {
      assert.equal(report.workers, 4497);
      assert.equal(report.movedTo, null);
    }
  });

  it('con otro NIT, o sin esa entidad, no se toca nada', () => {
    const other = resolveSigepNitCollisions({
      facts: [fact('899999003', 'EJERCITO NACIONAL DE COLOMBIA', 10, false)],
      ...chipMaps([['899999003', 'MINISTERIO DE DEFENSA NACIONAL']]),
    });
    assert.deepEqual(other.assignment, ['899999003']);
    assert.deepEqual(other.collisions, []);
  });
});


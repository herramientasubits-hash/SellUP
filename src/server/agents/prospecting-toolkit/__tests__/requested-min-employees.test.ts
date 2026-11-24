/**
 * Tests — FEEDBACK 24-11 (FIGARANTIAS SAS): el «más de 300 empleados» del criterio libre
 * llega al filtro de tamaño. Puro: cero red.
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractMinEmployeesFromCriteria,
  resolveRequestedMinEmployees,
} from '../requested-min-employees';
import { mapEmployeeThresholdToApolloRanges } from '../apollo-organizations-query-mapping';

const FIGARANTIAS_CRITERIA =
  'Que no sean clientes actuales de UBITS, que no tengan una reunión agendada en los últimos 90 días y que tengan mas de 300 empelados';

describe('extractMinEmployeesFromCriteria', () => {
  it('lee el criterio real del lote d546272c (con el typo «empelados») como 300', () => {
    assert.equal(extractMinEmployeesFromCriteria(FIGARANTIAS_CRITERIA), 300);
  });

  it('acepta las formas habituales', () => {
    assert.equal(extractMinEmployeesFromCriteria('con más de 200 empleados'), 200);
    assert.equal(extractMinEmployeesFromCriteria('empresas con 200+ empleados'), 200);
    assert.equal(extractMinEmployeesFromCriteria('mayores a 300 empleados'), 300);
    assert.equal(extractMinEmployeesFromCriteria('mínimo 400 colaboradores'), 400);
    assert.equal(extractMinEmployeesFromCriteria('al menos 250 trabajadores'), 250);
    assert.equal(extractMinEmployeesFromCriteria('>500'), 500);
    assert.equal(extractMinEmployeesFromCriteria('1.000 o más empleados'), 1000);
    assert.equal(extractMinEmployeesFromCriteria('more than 1,500 employees'), 1500);
  });

  it('no confunde días, sedes ni dinero con empleados', () => {
    assert.equal(extractMinEmployeesFromCriteria('sin reunión en más de 90 días'), null);
    assert.equal(extractMinEmployeesFromCriteria('con más de 300 sedes'), null);
    assert.equal(extractMinEmployeesFromCriteria('ventas de más de 5 millones'), null);
    assert.equal(extractMinEmployeesFromCriteria('over 20 years in business'), null);
    assert.equal(extractMinEmployeesFromCriteria('solo empresas B2B'), null);
    assert.equal(extractMinEmployeesFromCriteria(null), null);
  });

  it('con varios números manda el más alto', () => {
    assert.equal(extractMinEmployeesFromCriteria('más de 200 empleados, ideal más de 500 empleados'), 500);
  });
});

describe('resolveRequestedMinEmployees', () => {
  it('sube el piso del ICP cuando la persona pide más', () => {
    assert.equal(resolveRequestedMinEmployees(FIGARANTIAS_CRITERIA), 300);
  });

  it('nunca baja de 200', () => {
    assert.equal(resolveRequestedMinEmployees('más de 50 empleados'), 200);
    assert.equal(resolveRequestedMinEmployees(''), 200);
    assert.equal(resolveRequestedMinEmployees(null), 200);
  });
});

describe('rangos de Apollo con el umbral pedido', () => {
  it('con 300 sigue pidiendo «200,500» (contiene empresas de 300 a 500)', () => {
    assert.deepEqual(mapEmployeeThresholdToApolloRanges(300).slice(0, 2), ['200,500', '500,1000']);
  });

  it('200 y 500 dan lo mismo que antes', () => {
    assert.equal(mapEmployeeThresholdToApolloRanges(200)[0], '200,500');
    assert.equal(mapEmployeeThresholdToApolloRanges(500)[0], '500,1000');
  });
});

/**
 * A1-APOLLO-EMPLOYEE-FILTER-200-1 § 7 — el gate ICP local NO se relaja.
 *
 * Mandar un filtro a Apollo no es lo mismo que poder confiar en Apollo.
 *
 * Lo que la auditoría dejó ver: la respuesta de `mixed_companies/search` NO trae
 * empleados. En las 20 corridas revisadas, `employee_count` llegó `null` en el
 * 100% de las muestras, con `raw_keys_present` típico
 * `["name","website_url","primary_domain","linkedin_url"]`. Es decir: hoy no
 * tenemos con qué contradecir al proveedor si incumple el filtro.
 *
 * Por eso el desconocido tiene que seguir yendo a revisión humana, no a `pass`.
 * Si alguien razonara «ya filtramos en origen, lo que vuelve es grande por
 * definición» y convirtiera el desconocido en `pass`, el filtro nuevo se habría
 * convertido en una excusa para dejar de verificar — y ese cambio es
 * indetectable sin esta suite.
 *
 * Puro: sin proveedor, sin base de datos, sin red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateIcpSizeGate,
  resolveIcpSizeGateWriterAction,
} from '../icp-size-gate';

describe('§ 7 — tamaño desconocido sigue siendo needs_validation', () => {
  it('employee_count = null ⇒ needs_validation, NUNCA pass', () => {
    const result = evaluateIcpSizeGate({ employeeCount: null });

    assert.equal(result.decision, 'needs_validation');
    assert.notEqual(result.decision, 'pass');
    assert.equal(result.size_status, 'unknown');
    assert.equal(result.requires_human_review, true);
  });

  it('sin ningún dato de tamaño ⇒ needs_validation, NUNCA pass ni block', () => {
    const result = evaluateIcpSizeGate({});

    assert.equal(result.decision, 'needs_validation');
    assert.notEqual(result.decision, 'pass');
    assert.notEqual(result.decision, 'block');
  });

  it('el writer manda el desconocido a revisión humana, no al flujo normal', () => {
    const action = resolveIcpSizeGateWriterAction(
      evaluateIcpSizeGate({ employeeCount: null }),
    );

    assert.equal(action.action, 'needs_review');
    assert.notEqual(action.action, 'pass');
  });

  it('el payload real de búsqueda de Apollo —sólo nombre y dominio— no basta para aprobar', () => {
    // Forma exacta que devolvió Apollo en la corrida 5ba7000a (2026-09-07):
    // nombre y dominio presentes, tamaño ausente.
    const result = evaluateIcpSizeGate({
      employeeCount: null,
      sizeRange: null,
      sizeStatus: null,
      source: 'apollo',
    });

    assert.equal(result.decision, 'needs_validation');
  });
});

// ── § 8 — el umbral es INCLUSIVO en las dos puntas de la cadena ──────────────
//
// Ésta es la alineación del hito: «200+ empleados» incluye 200, y ese `>=` rige
// tanto lo que se le pide a Apollo (primer bucket `"200,500"`) como lo que se
// admite al llegar. Antes el gate exigía `> 200`, así que una empresa de 200
// exactos se pedía, se pagaba y se descartaba después con nuestro propio gate.

describe('§ 8 — el umbral local es 200 INCLUSIVO', () => {
  it('threshold default = 200', () => {
    assert.equal(evaluateIcpSizeGate({ employeeCount: null }).threshold, 200);
  });

  it('200 exactos APRUEBAN — 200+ incluye 200', () => {
    const result = evaluateIcpSizeGate({ employeeCount: 200 });

    assert.equal(result.decision, 'pass');
    assert.notEqual(result.decision, 'block');
    assert.equal(result.size_status, 'confirmed_above_threshold');
    assert.equal(result.requires_human_review, false);
  });

  it('199 empleados sigue bloqueado', () => {
    const result = evaluateIcpSizeGate({ employeeCount: 199 });
    assert.equal(result.decision, 'block');
    assert.equal(result.size_status, 'confirmed_below_threshold');
  });

  it('201 empleados sigue pasando', () => {
    const result = evaluateIcpSizeGate({ employeeCount: 201 });
    assert.equal(result.decision, 'pass');
    assert.equal(result.size_status, 'confirmed_above_threshold');
  });

  it('el writer NO descarta por tamaño a una empresa de 200 exactos', () => {
    // La afirmación que cierra el hito: lo que se le pide a Apollo y lo que el
    // writer admite son la misma pregunta. Nada se compra para tirarlo después.
    const action = resolveIcpSizeGateWriterAction(
      evaluateIcpSizeGate({ employeeCount: 200 }),
    );

    assert.equal(action.action, 'pass');
    assert.notEqual(action.action, 'skip');
    assert.equal(action.skipReason, undefined);
  });

  it('el borde inferior no se corre: 199 sigue siendo skip para el writer', () => {
    const action = resolveIcpSizeGateWriterAction(
      evaluateIcpSizeGate({ employeeCount: 199 }),
    );

    assert.equal(action.action, 'skip');
    assert.equal(action.skipReason, 'icp_size_below_threshold');
  });
});

describe('§ 8 — la vía de rangos comparte el mismo umbral inclusivo', () => {
  it('un rango cuyo mínimo ES el umbral aprueba — "200-500" ⇒ pass', () => {
    // Es el primer bucket que ahora viaja a Apollo. Bajo `>=`, todo lo que cae
    // en él califica, así que dejarlo sin resolver sería incoherente con que un
    // conteo de 200 apruebe.
    const result = evaluateIcpSizeGate({ sizeRange: '200-500' });

    assert.equal(result.decision, 'pass');
    assert.equal(result.normalized_min_employees, 200);
  });

  it('un rango cuyo máximo ES el umbral va a revisión, NO a pass ni a block', () => {
    // "51-200" puede contener una empresa de 200 empleados, que ahora califica:
    // bloquearlo afirmaría que no hay ninguna admisible ahí, y es falso. Va a
    // revisión humana — el lado seguro, nunca aprobación automática.
    const result = evaluateIcpSizeGate({ sizeRange: '51-200' });

    assert.equal(result.decision, 'needs_validation');
    assert.equal(result.requires_human_review, true);
    assert.notEqual(result.decision, 'pass');
  });

  it('un rango cuyo mínimo supera el umbral sigue aprobando', () => {
    assert.equal(evaluateIcpSizeGate({ sizeRange: '500-1000' }).decision, 'pass');
  });

  it('un rango enteramente por debajo del umbral sigue bloqueando', () => {
    assert.equal(evaluateIcpSizeGate({ sizeRange: '10-50' }).decision, 'block');
    assert.equal(evaluateIcpSizeGate({ sizeRange: '51-199' }).decision, 'block');
  });

  it('"200+" abierto por arriba aprueba', () => {
    assert.equal(evaluateIcpSizeGate({ sizeRange: '200+' }).decision, 'pass');
  });
});

/**
 * company-field-trace.test.ts
 *
 * AGENT1-APOLLO-LINKEDIN-QUALITY-INTEGRATION-1 · § G.
 *
 * «El campo no está» tenía cinco causas posibles y ninguna forma de
 * distinguirlas. Estas pruebas fijan que cada una se lee directamente de la
 * traza, y en particular que un valor que SÍ llegó del proveedor y se perdió
 * después nunca se reporte como ausencia del proveedor.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompanyLinkedInTrace,
  buildEmployeeCountTrace,
  type CompanyLinkedInCapture,
  type EmployeeCountCapture,
  type CompanyFieldMappingStatus,
} from '../apollo-company-fields-mapping';

function linkedInCapture(
  status: CompanyFieldMappingStatus,
  url: string | null,
): CompanyLinkedInCapture {
  return {
    companyLinkedInUrl: url,
    rawValue: url,
    status,
    sourceProvider: status === 'not_returned' ? null : 'apollo',
    sourceOperation: status === 'not_returned' ? null : 'organization_enrichment',
    observedAt: status === 'not_returned' ? null : '2026-08-05T22:19:00.000Z',
    reason: null,
  };
}

function employeeCapture(
  status: CompanyFieldMappingStatus,
  count: number | null,
): EmployeeCountCapture {
  return {
    employeeCount: count,
    rawValue: count,
    status,
    sourceProvider: status === 'not_returned' ? null : 'apollo',
    sourceOperation: status === 'not_returned' ? null : 'organization_enrichment',
    observedAt: status === 'not_returned' ? null : '2026-08-05T22:19:00.000Z',
    reason: null,
  };
}

const WITH_KEY = {
  sourceRequestId: 'usage-key-abc',
  persistenceMode: 'column' as const,
};

describe('§ G · trazabilidad del LinkedIn empresarial', () => {
  test('confirmado: las cinco etapas en verde y la procedencia completa', () => {
    const trace = buildCompanyLinkedInTrace(
      linkedInCapture('confirmed', 'https://www.linkedin.com/company/acme'),
      WITH_KEY,
    );

    assert.equal(trace.returned_by_provider, true);
    assert.equal(trace.normalized, true);
    assert.equal(trace.sent_to_writer, true);
    assert.equal(trace.persisted, true);
    assert.equal(trace.displayed, true);
    assert.equal(trace.source_provider, 'apollo');
    assert.equal(trace.source_operation, 'organization_enrichment');
    assert.equal(trace.source_request_id, 'usage-key-abc');
    assert.equal(trace.observed_at, '2026-08-05T22:19:00.000Z');
    assert.equal(trace.mapping_status, 'confirmed');
    assert.equal(trace.persistence_mode, 'column');
  });

  test('not_returned: el proveedor NO lo devolvió, y así se dice', () => {
    const trace = buildCompanyLinkedInTrace(linkedInCapture('not_returned', null), {
      sourceRequestId: null,
      persistenceMode: 'not_persisted',
    });

    assert.equal(trace.returned_by_provider, false);
    assert.equal(trace.normalized, false);
    assert.equal(trace.sent_to_writer, false);
    assert.equal(trace.persisted, false);
    assert.equal(trace.displayed, false);
    // Sin operación pagada no hay clave que citar, y no se inventa una.
    assert.equal(trace.source_request_id, null);
  });

  test('mapping_failed: llegó del proveedor y se perdió DESPUÉS', () => {
    const trace = buildCompanyLinkedInTrace(
      linkedInCapture('mapping_failed', null),
      { sourceRequestId: 'usage-key-abc', persistenceMode: 'not_persisted' },
    );

    // Ésta es la distinción que el hito compra: una pérdida interna no puede
    // reportarse como «el proveedor no lo devolvió».
    assert.equal(trace.returned_by_provider, true);
    assert.equal(trace.normalized, false);
    assert.equal(trace.persisted, false);
    assert.equal(trace.mapping_status, 'mapping_failed');
  });

  test('invalid: llegó, pero no pasó la normalización', () => {
    const trace = buildCompanyLinkedInTrace(linkedInCapture('invalid', null), {
      sourceRequestId: null,
      persistenceMode: 'not_persisted',
    });

    assert.equal(trace.returned_by_provider, true);
    assert.equal(trace.normalized, false);
    assert.equal(trace.mapping_status, 'invalid');
  });

  test('metadata_only: se guardó, pero no en la columna', () => {
    const trace = buildCompanyLinkedInTrace(
      linkedInCapture('confirmed', 'https://www.linkedin.com/company/acme'),
      { sourceRequestId: null, persistenceMode: 'metadata_only' },
    );

    assert.equal(trace.persisted, true);
    assert.equal(trace.persistence_mode, 'metadata_only');
    // Un despliegue gradual no es un fallo: el valor está y se muestra.
    assert.equal(trace.displayed, true);
  });
});

describe('§ G · trazabilidad del número de empleados', () => {
  test('confirmado: se envía al writer y se persiste en columna', () => {
    const trace = buildEmployeeCountTrace(employeeCapture('confirmed', 470), WITH_KEY);

    assert.equal(trace.returned_by_provider, true);
    assert.equal(trace.normalized, true);
    assert.equal(trace.sent_to_writer, true);
    assert.equal(trace.persisted, true);
    assert.equal(trace.persistence_mode, 'column');
  });

  test('not_returned: no se envía nada y nada se persiste', () => {
    const trace = buildEmployeeCountTrace(employeeCapture('not_returned', null), {
      sourceRequestId: null,
      persistenceMode: 'not_persisted',
    });

    assert.equal(trace.returned_by_provider, false);
    assert.equal(trace.sent_to_writer, false);
    assert.equal(trace.persisted, false);
  });

  test('invalid: un valor fuera de rango llegó pero no se guarda', () => {
    const trace = buildEmployeeCountTrace(employeeCapture('invalid', null), {
      sourceRequestId: 'usage-key-abc',
      persistenceMode: 'not_persisted',
    });

    assert.equal(trace.returned_by_provider, true);
    assert.equal(trace.normalized, false);
    assert.equal(trace.persisted, false);
    assert.equal(trace.source_request_id, 'usage-key-abc');
  });
});

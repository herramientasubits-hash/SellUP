/**
 * SOURCES-MX-SIZE-BAND-1 — México no informa trabajadores: declara un TRAMO
 * (MICRO / PEQUEÑA / MEDIANA / GRANDE) en CompraNet y en el padrón de Nuevo León.
 * El tramo llega por el RFC por nombre (sólo con coincidencia fuerte) y alimenta
 * el gate ICP de tamaño:
 *   · MICRO (0–10) y PEQUEÑA (11–50) ⇒ empresa pequeña: el gate la bloquea;
 *   · MEDIANA (31–250) y GRANDE (101+) NO deciden solas (umbral ICP 200): unknown;
 *   · el SII de Chile (trabajadores informados) no cambia.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractOfficialRegistryWorkforce, resolveEmployeeSizeForIcpGate } from '../employee-size-resolver';
import { evaluateIcpSizeGate, resolveIcpSizeGateWriterAction } from '../icp-size-gate';
import { MX_STRATIFICATION_BANDS, workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';

function decide(rawData: Record<string, unknown>, sourceYear: number | null = 2026) {
  const workforce = workforceFromRawData(rawData, 'mx_compranet_rfc_registry', sourceYear);
  const candidate = {
    name: 'Empresa SA de CV',
    officialSourceIdentity: { officialSourceMetadata: { workforce }, typedColumns: {}, strongIdentityAvailable: true },
  };
  const registry = extractOfficialRegistryWorkforce(candidate);
  const resolved = resolveEmployeeSizeForIcpGate({ threshold: 200, referenceYear: 2026, officialRegistryWorkforce: registry });
  const gate = evaluateIcpSizeGate(resolved.icpInput);
  return { workforce, registry, resolved, action: resolveIcpSizeGateWriterAction(gate).action };
}

describe('tramo declarado de México → tamaño', () => {
  it('estratificación → piso, techo y nombre del tramo', () => {
    assert.deepEqual(workforceFromRawData({ stratification: 'MICRO', last_contract_year: 2025 }, 'mx_compranet_rfc_registry'), {
      workers: 0, year: 2025, source: 'mx_compranet_rfc_registry', maxWorkers: 10, sizeBand: 'micro',
    });
    assert.equal(workforceFromRawData({ stratification: 'NO MIPYME', last_contract_year: 2024 }, 'x')?.sizeBand, 'grande');
    assert.equal(workforceFromRawData({ stratification: 'PEQUEÑA' }, 'x', 2026)?.year, 2026, 'sin año propio usa el de la carga');
    assert.equal(workforceFromRawData({ stratification: 'PEQUEÑA' }, 'x', null), null, 'sin año no hay dato');
    assert.equal(workforceFromRawData({ stratification: 'DESCONOCIDA' }, 'x', 2026), null);
    assert.equal(Object.keys(MX_STRATIFICATION_BANDS).includes('MEDIANA'), true);
  });

  it('MICRO y PEQUEÑA ⇒ pequeña: el gate la bloquea', () => {
    for (const stratification of ['MICRO', 'PEQUEÑA']) {
      const { resolved, action } = decide({ stratification, last_contract_year: 2025 });
      assert.equal(resolved.selectedSource, 'official_registry_workers', stratification);
      assert.notEqual(action, 'allow', stratification);
      assert.match(resolved.attemptedSources.at(-1)?.reason ?? '', /empresa pequeña/);
    }
  });

  it('MEDIANA y GRANDE no deciden solas (umbral 200): unknown', () => {
    for (const stratification of ['MEDIANA', 'GRANDE', 'NO MIPYME']) {
      const { resolved } = decide({ stratification, last_contract_year: 2025 });
      assert.notEqual(resolved.selectedSource, 'official_registry_workers', stratification);
      assert.equal(resolved.attemptedSources.find((a) => a.source === 'official_registry_workers')?.usable, false, stratification);
    }
  });

  it('un tramo viejo (más de 3 años) no decide', () => {
    const { resolved } = decide({ stratification: 'MICRO', last_contract_year: 2019 });
    assert.notEqual(resolved.selectedSource, 'official_registry_workers');
  });

  it('el SII de Chile (trabajadores informados) sigue igual', () => {
    const wf = workforceFromRawData({ workers: 9, metrics_year: 2024 }, 'cl_sii_registry');
    assert.deepEqual(wf, { workers: 9, year: 2024, source: 'cl_sii_registry', salesBracket: null });
  });
});

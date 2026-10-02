/**
 * SOURCES-PE-POST-APPROVAL-REGISTRY-FALLBACK-1 — la confirmación del RUC después
 * de aprobar lee también pe_sunat_registry cuando el snapshot antiguo
 * (peru_sunat_ruc_snapshot, vacío en Producción) no tiene la fila. Así una
 * sociedad activa y habida queda «verified» y NO se llama al respaldo de pago Migo.
 * Cliente falso: nunca sale a la red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  lookupPeruSunatByRuc,
  registryRowToSnapshotRow,
} from '../peru-sunat-legal-lookup';
import { isMigoFallbackRequired } from '@/server/prospect-batches/post-approval-nit-enrichment-worker';

type Reply = { data: unknown; error: unknown };

/** Cliente falso: responde por tabla y anota los filtros de cada consulta. */
function fakeClient(replies: Record<string, Reply>) {
  const calls: { table: string; filters: [string, unknown][] }[] = [];
  const client = {
    from(table: string) {
      const call = { table, filters: [] as [string, unknown][] };
      calls.push(call);
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        limit: () => chain,
        maybeSingle: async () => replies[table] ?? { data: null, error: null },
      };
      return chain;
    },
  };
  return { client: client as never, calls };
}

const RUC = '20100047218';
const registryRow = {
  normalized_tax_id: RUC,
  legal_name: 'BANCO DE CREDITO DEL PERU',
  source_year: 2026,
  imported_at: '2026-09-30T00:00:00.000Z',
  raw_data: { ubigeo: '150101' },
};

describe('confirmación del RUC después de aprobar (Perú)', () => {
  it('snapshot antiguo vacío + RUC en pe_sunat_registry → verified, y Migo NO se llama', async () => {
    const { client, calls } = fakeClient({ source_company_snapshots: { data: registryRow, error: null } });
    const result = await lookupPeruSunatByRuc(RUC, client);
    assert.equal(result.status, 'verified');
    assert.equal(result.reason, 'ruc_found_active_habido');
    assert.equal(result.legalName, 'BANCO DE CREDITO DEL PERU');
    assert.equal(result.ubigeo, '150101');
    assert.equal(result.snapshotPeriod, '2026');
    assert.equal(isMigoFallbackRequired(result.status), false);
    assert.deepEqual(calls.map((c) => c.table), ['peru_sunat_ruc_snapshot', 'source_company_snapshots']);
    assert.deepEqual(calls[1].filters, [
      ['source_key', 'pe_sunat_registry'],
      ['normalized_tax_id', RUC],
    ]);
  });

  it('en ninguna de las dos → not_found, y Migo sigue como respaldo', async () => {
    const { client } = fakeClient({});
    const result = await lookupPeruSunatByRuc(RUC, client);
    assert.equal(result.status, 'not_found');
    assert.equal(isMigoFallbackRequired(result.status), true);
  });

  it('si el snapshot antiguo tiene la fila, manda él y no se consulta nada más', async () => {
    const legacy = {
      ruc: RUC, legal_name: 'BCP', taxpayer_status: 'ACTIVO', domicile_condition: 'NO HABIDO', ubigeo: null,
      department: null, province: null, district: null, address: null, source_key: 'pe_sunat_bulk',
      snapshot_period: null, snapshot_loaded_at: null, is_active: true, is_habido: false,
    };
    const { client, calls } = fakeClient({
      peru_sunat_ruc_snapshot: { data: legacy, error: null },
      source_company_snapshots: { data: registryRow, error: null },
    });
    const result = await lookupPeruSunatByRuc(RUC, client);
    assert.equal(result.status, 'flagged');
    assert.equal(result.reason, 'domicile_not_habido');
    assert.equal(calls.length, 1);
  });

  it('error al leer pe_sunat_registry → snapshot_unavailable (no inventa un «verified»)', async () => {
    const { client } = fakeClient({ source_company_snapshots: { data: null, error: { message: 'boom' } } });
    const result = await lookupPeruSunatByRuc(RUC, client);
    assert.equal(result.status, 'snapshot_unavailable');
  });

  it('un RUC inválido no consulta nada', async () => {
    const { client, calls } = fakeClient({});
    const result = await lookupPeruSunatByRuc('123', client);
    assert.equal(result.reason, 'invalid_ruc_format');
    assert.equal(calls.length, 0);
  });

  it('la fila de pe_sunat_registry es siempre activa y habida (así se cargó)', () => {
    const row = registryRowToSnapshotRow({ ...registryRow, raw_data: null, source_year: null });
    assert.equal(row.is_active, true);
    assert.equal(row.is_habido, true);
    assert.equal(row.source_key, 'pe_sunat_registry');
    assert.equal(row.ubigeo, null);
    assert.equal(row.snapshot_period, null);
  });
});

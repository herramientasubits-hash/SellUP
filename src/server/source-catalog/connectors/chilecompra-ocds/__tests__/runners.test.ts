/**
 * Tests — ChileCompra OCDS Runners (health-check + dry-run)
 *
 * fetch global stubeado por URL (listado vs tender). Sin red real, sin Supabase.
 * Verifica writes_performed = 0 y que un detalle fallido no aborte todo el dry-run.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChileCompraOcdsHealthCheck } from '../run-chilecompra-ocds-health-check';
import { runChileCompraOcdsDryRun } from '../run-chilecompra-ocds-dry-run';

const _origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = _origFetch;
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeReleaseBody(ocid: string) {
  return {
    releases: [
      {
        ocid,
        tender: {
          id: ocid,
          title: `Licitación ${ocid}`,
          status: 'active',
          value: { amount: 1000, currency: 'CLP' },
          items: [{ classification: { scheme: 'UNSPSC', id: '76111500', description: 'Limpieza' } }],
        },
        parties: [
          {
            id: 'B1',
            name: 'Municipalidad X',
            roles: ['buyer'],
            identifier: { scheme: 'CL-RUT', id: '69.070.100-6' },
            address: { region: 'RM', countryName: 'Chile' },
          },
        ],
        buyer: { id: 'B1', name: 'Municipalidad X' },
        awards: [],
      },
    ],
  };
}

describe('runChileCompraOcdsHealthCheck', () => {
  it('operativo con writes_performed = 0', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ pagination: { total: 99 }, data: [{ ocid: 'ocds-1', urlTender: 'u1' }] })) as typeof fetch;
    const report = await runChileCompraOcdsHealthCheck({ year: 2026, month: 6 });
    assert.equal(report.status, 'operational');
    assert.equal(report.totalMonthProcesses, 99);
    assert.equal(report.writes_performed, 0);
    assert.deepEqual(report.firstOcids, ['ocds-1']);
  });

  it('error cuando falta total', async () => {
    globalThis.fetch = (async () => jsonResponse({ data: [{ ocid: 'ocds-1' }] })) as typeof fetch;
    const report = await runChileCompraOcdsHealthCheck({ year: 2026, month: 6 });
    assert.equal(report.status, 'error');
    assert.equal(report.writes_performed, 0);
  });

  it('error en HTTP no-200', async () => {
    globalThis.fetch = (async () => jsonResponse({}, 503)) as typeof fetch;
    const report = await runChileCompraOcdsHealthCheck({ year: 2026, month: 6 });
    assert.equal(report.status, 'error');
  });
});

describe('runChileCompraOcdsDryRun', () => {
  it('devuelve preview con writes_performed = 0', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('listaOCDSAgnoMes')) {
        return jsonResponse({
          pagination: { total: 2 },
          data: [
            { ocid: 'ocds-1', urlTender: 'u1' },
            { ocid: 'ocds-2', urlTender: 'u2' },
          ],
        });
      }
      const ocid = url.includes('ocds-2') ? 'ocds-2' : 'ocds-1';
      return jsonResponse(makeReleaseBody(ocid));
    }) as typeof fetch;

    const report = await runChileCompraOcdsDryRun({ year: 2026, month: 6, sampleSize: 2 });
    assert.equal(report.summary.writes_performed, 0);
    assert.equal(report.summary.details_attempted, 2);
    assert.equal(report.summary.details_success, 2);
    assert.equal(report.items.length, 2);
    assert.equal(report.summary.total_month_processes, 2);
  });

  it('un detalle fallido NO aborta todo el dry-run', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('listaOCDSAgnoMes')) {
        return jsonResponse({
          pagination: { total: 2 },
          data: [
            { ocid: 'ocds-1', urlTender: 'u1' },
            { ocid: 'ocds-2', urlTender: 'u2' },
          ],
        });
      }
      if (url.includes('ocds-2')) {
        return jsonResponse({ error: 'boom' }, 500);
      }
      return jsonResponse(makeReleaseBody('ocds-1'));
    }) as typeof fetch;

    const report = await runChileCompraOcdsDryRun({ year: 2026, month: 6, sampleSize: 2 });
    assert.equal(report.summary.details_attempted, 2);
    assert.equal(report.summary.details_success, 1);
    assert.equal(report.summary.details_failed, 1);
    assert.equal(report.items.length, 1);
    assert.equal(report.summary.writes_performed, 0);
  });

  it('empty state cuando el mes no trae procesos', async () => {
    globalThis.fetch = (async () => jsonResponse({ pagination: { total: 0 }, data: [] })) as typeof fetch;
    const report = await runChileCompraOcdsDryRun({ year: 2026, month: 6, sampleSize: 5 });
    assert.equal(report.items.length, 0);
    assert.equal(report.summary.listed_count, 0);
    assert.equal(report.summary.writes_performed, 0);
  });

  it('listado con OCID completo → detalle consultado con tender id extraído', async () => {
    const detailUrls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('listaOCDSAgnoMes')) {
        return jsonResponse({
          pagination: { total: 1 },
          data: [{ ocid: 'ocds-70d2nz-4280-18-LP26', urlTender: 'https://mp.cl/t/4280' }],
        });
      }
      detailUrls.push(url);
      // El detalle real responde solo si la URL trae el tender id, no el OCID.
      return jsonResponse(makeReleaseBody('ocds-70d2nz-4280-18-LP26'));
    }) as typeof fetch;

    const report = await runChileCompraOcdsDryRun({ year: 2026, month: 6, sampleSize: 1 });
    assert.equal(detailUrls.length, 1);
    assert.ok(detailUrls[0].endsWith('/tender/4280-18-LP26'), `recibida: ${detailUrls[0]}`);
    assert.ok(!detailUrls[0].includes('ocds-70d2nz'));
    assert.equal(report.summary.details_success, 1);
    // ocid original preservado; tender_id = id extraído.
    assert.equal(report.items[0].ocid, 'ocds-70d2nz-4280-18-LP26');
    assert.equal(report.items[0].tender_id, '4280-18-LP26');
  });

  it('procesos listados pero todos los detalles fallan → listed_count>0 sin empty state', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('listaOCDSAgnoMes')) {
        return jsonResponse({
          pagination: { total: 8863 },
          data: [
            { ocid: 'ocds-70d2nz-4280-18-LP26', urlTender: 'u1' },
            { ocid: 'ocds-70d2nz-705290-49-LR26', urlTender: 'u2' },
          ],
        });
      }
      return jsonResponse({ error: 'boom' }, 500);
    }) as typeof fetch;

    const report = await runChileCompraOcdsDryRun({ year: 2026, month: 6, sampleSize: 2 });
    assert.equal(report.items.length, 0);
    assert.equal(report.summary.listed_count, 2);
    assert.equal(report.summary.details_failed, 2);
    assert.equal(report.summary.details_success, 0);
    // El runner ya NO está en estado vacío real: listó procesos.
    assert.ok(report.summary.listed_count > 0 && report.summary.details_failed > 0);
  });
});

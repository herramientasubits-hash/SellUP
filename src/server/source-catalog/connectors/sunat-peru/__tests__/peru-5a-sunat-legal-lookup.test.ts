/**
 * Perú.5A — SUNAT Legal Lookup Foundation Tests
 *
 * Tests for src/server/services/peru-sunat-legal-lookup.ts
 * Uses Node.js built-in test module. Pure function tests only —
 * no Supabase connection required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildLegalLookupResult,
  type PeruSunatRucSnapshotRow,
} from '../../../../services/peru-sunat-legal-lookup';

const __filename = fileURLToPath(import.meta.url);
const __dirname_path = dirname(__filename);

const SERVICE_FILE = join(
  __dirname_path,
  '..',
  '..',
  '..',
  '..',
  'services',
  'peru-sunat-legal-lookup.ts',
);

function makeRow(overrides: Partial<PeruSunatRucSnapshotRow> = {}): PeruSunatRucSnapshotRow {
  return {
    ruc: '20100047218',
    legal_name: 'EMPRESA TEST SAC',
    taxpayer_status: 'ACTIVO',
    domicile_condition: 'HABIDO',
    ubigeo: '150101',
    department: 'LIMA',
    province: 'LIMA',
    district: 'LIMA',
    address: 'AV TEST 123',
    source_key: 'pe_sunat_bulk',
    snapshot_period: '2024-06',
    snapshot_loaded_at: '2024-06-01T00:00:00Z',
    is_active: true,
    is_habido: true,
    ...overrides,
  };
}

// ── Status logic ───────────────────────────────────────────────

describe('Perú.5A — buildLegalLookupResult: status logic', () => {
  it('01: RUC inválido → reason invalid_ruc_format', () => {
    const result = buildLegalLookupResult('abc', null, { snapshotAvailable: true });
    assert.equal(result.reason, 'invalid_ruc_format');
  });

  it('01b: RUC inválido demasiado corto → reason invalid_ruc_format', () => {
    const result = buildLegalLookupResult('123', null, { snapshotAvailable: true });
    assert.equal(result.reason, 'invalid_ruc_format');
  });

  it('02: RUC no encontrado en snapshot → status not_found', () => {
    const result = buildLegalLookupResult('20100047218', null, { snapshotAvailable: true });
    assert.equal(result.status, 'not_found');
    assert.equal(result.reason, 'ruc_not_found_in_snapshot');
  });

  it('03: RUC ACTIVO + HABIDO → status verified', () => {
    const result = buildLegalLookupResult('20100047218', makeRow(), { snapshotAvailable: true });
    assert.equal(result.status, 'verified');
    assert.equal(result.reason, 'ruc_found_active_habido');
    assert.equal(result.isActive, true);
    assert.equal(result.isHabido, true);
  });

  it('04: RUC ACTIVO + NO HABIDO → status flagged, reason domicile_not_habido', () => {
    const result = buildLegalLookupResult(
      '20100047218',
      makeRow({ is_habido: false, domicile_condition: 'NO HABIDO' }),
      { snapshotAvailable: true },
    );
    assert.equal(result.status, 'flagged');
    assert.equal(result.reason, 'domicile_not_habido');
    assert.equal(result.isActive, true);
    assert.equal(result.isHabido, false);
  });

  it('05: RUC BAJA/INACTIVO → status flagged, reason taxpayer_inactive', () => {
    const result = buildLegalLookupResult(
      '20100047218',
      makeRow({ is_active: false, taxpayer_status: 'BAJA DE OFICIO' }),
      { snapshotAvailable: true },
    );
    assert.equal(result.status, 'flagged');
    assert.equal(result.reason, 'taxpayer_inactive');
    assert.equal(result.isActive, false);
  });

  it('06: Snapshot no disponible → status snapshot_unavailable', () => {
    const result = buildLegalLookupResult('20100047218', null, { snapshotAvailable: false });
    assert.equal(result.status, 'snapshot_unavailable');
    assert.equal(result.reason, 'snapshot_not_loaded');
  });
});

// ── Result shape — sin CIIU ni sector ─────────────────────────

describe('Perú.5A — buildLegalLookupResult: resultado no contiene CIIU ni sector', () => {
  it('07: resultado verified no incluye campo ciiu', () => {
    const result = buildLegalLookupResult('20100047218', makeRow(), { snapshotAvailable: true });
    assert.equal('ciiu' in result, false, 'result no debe tener campo ciiu');
    assert.equal('official_ciiu' in result, false, 'result no debe tener campo official_ciiu');
    assert.equal('ciiu_code' in result, false, 'result no debe tener campo ciiu_code');
  });

  it('08: resultado verified no incluye campo sector', () => {
    const result = buildLegalLookupResult('20100047218', makeRow(), { snapshotAvailable: true });
    assert.equal('sector' in result, false, 'result no debe tener campo sector');
    assert.equal('sector_inferred' in result, false, 'result no debe tener campo sector_inferred');
    assert.equal('sector_source' in result, false, 'result no debe tener campo sector_source');
  });
});

// ── Guardrails: análisis de código fuente del servicio ─────────
//
// Las verificaciones se aplican sobre líneas NO comentadas del servicio.
// El bloque JSDoc del servicio puede mencionar patrones prohibidos como
// documentación del guardrail; lo que se prohíbe es que aparezcan en
// código ejecutable (imports, llamadas, strings de consulta, etc.).

function stripCommentLines(content: string): string {
  return content
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('Perú.5A — Guardrails: código fuente del servicio (líneas no comentadas)', () => {
  let executableContent: string;

  it('setup: el archivo del servicio existe y tiene contenido', () => {
    const raw = readFileSync(SERVICE_FILE, 'utf-8');
    executableContent = stripCommentLines(raw);
    assert.ok(executableContent.length > 50, 'El archivo del servicio existe y tiene contenido');
  });

  it('09: no lee .tmp/sunat-peru en código ejecutable', () => {
    const content = stripCommentLines(readFileSync(SERVICE_FILE, 'utf-8'));
    assert.equal(
      content.includes('.tmp/sunat-peru'),
      false,
      'El servicio no debe referenciar .tmp/sunat-peru en código ejecutable',
    );
  });

  it('10: no referencia padron_reducido_ruc.zip en código ejecutable', () => {
    const content = stripCommentLines(readFileSync(SERVICE_FILE, 'utf-8'));
    assert.equal(
      content.includes('padron_reducido_ruc.zip'),
      false,
      'El servicio no debe referenciar padron_reducido_ruc.zip en código ejecutable',
    );
  });

  it('11: no descarga desde SUNAT (no www2.sunat)', () => {
    const content = stripCommentLines(readFileSync(SERVICE_FILE, 'utf-8'));
    assert.equal(
      content.includes('www2.sunat'),
      false,
      'El servicio no debe descargar desde SUNAT',
    );
  });

  it('12: no llama Migo API (no MIGO_API_KEY ni api.migo.pe)', () => {
    const content = stripCommentLines(readFileSync(SERVICE_FILE, 'utf-8'));
    const hasMigo =
      content.includes('MIGO_API_KEY') || content.includes('api.migo.pe');
    assert.equal(hasMigo, false, 'El servicio no debe llamar a la API de Migo');
  });

  it('13: no llama Tavily en código ejecutable', () => {
    const content = stripCommentLines(readFileSync(SERVICE_FILE, 'utf-8'));
    const hasTavily =
      content.includes('tavily') || content.includes('Tavily');
    assert.equal(hasTavily, false, 'El servicio no debe llamar a Tavily');
  });

  it('14: no crea candidatos ni batches en código ejecutable', () => {
    const content = stripCommentLines(readFileSync(SERVICE_FILE, 'utf-8'));
    const hasProspectInsert =
      content.includes('prospect_candidates') ||
      content.includes('prospect_batches');
    assert.equal(
      hasProspectInsert,
      false,
      'El servicio no debe insertar en prospect_candidates ni prospect_batches',
    );
  });
});

// ── Campos devueltos por verified ─────────────────────────────

describe('Perú.5A — buildLegalLookupResult: campos en resultado verified', () => {
  it('resultado verified incluye ruc, legalName, department, checkedAt', () => {
    const row = makeRow({
      ruc: '20100047218',
      legal_name: 'EMPRESA TEST SAC',
      department: 'LIMA',
    });
    const result = buildLegalLookupResult('20100047218', row, { snapshotAvailable: true });
    assert.equal(result.ruc, '20100047218');
    assert.equal(result.legalName, 'EMPRESA TEST SAC');
    assert.equal(result.department, 'LIMA');
    assert.ok(typeof result.checkedAt === 'string', 'checkedAt debe ser string ISO');
    assert.ok(result.checkedAt.includes('T'), 'checkedAt debe ser ISO 8601');
  });

  it('RUC con espacios se normaliza antes de validar', () => {
    const row = makeRow({ ruc: '20100047218' });
    const result = buildLegalLookupResult(' 20100047218 ', row, { snapshotAvailable: true });
    assert.equal(result.status, 'verified');
    assert.equal(result.ruc, '20100047218');
  });
});

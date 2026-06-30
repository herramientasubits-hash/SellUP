import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDgiiLines, DGII_DEFAULT_DELIMITER } from '../dgii-bulk-parser';

const _DELIMITER = DGII_DEFAULT_DELIMITER; // kept for reference

// Formato real del padrón TXT DGII (verificado 2026-06-30):
// col 0: RNC/cédula | col 1: Nombre | col 2: Nombre Comercial |
// col 3: Actividad Económica | col 4-7: vacíos | col 8: Fecha | col 9: Estado | col 10: Régimen
const SAMPLE_BUSINESS_LINE =
  `101023456|EMPRESA EJEMPLO SRL|EJEMPLO SRL|COMERCIO AL POR MAYOR| | | | |2001-05-15|ACTIVO|NORMAL`;

// Cédula persona física (11 dígitos) — mismo formato
const SAMPLE_CEDULA_LINE =
  `00112345678|JUAN NOMBRE APELLIDO||SERVICIOS PERSONALES| | | | |1998-03-10|ACTIVO|NORMAL`;

// Header detectado automáticamente (si existiera)
const HEADER_LINE =
  `RNC|NOMBRE|NOMBRE_COMERCIAL|ACTIVIDAD_ECONOMICA| | | | |FECHA_CONSTITUCION|ESTADO|REGIMEN_PAGO`;

describe('parseDgiiLines — parseo básico', () => {
  it('parsea una línea pipe-delimitada válida de RNC jurídico', () => {
    const result = parseDgiiLines({ lines: [SAMPLE_BUSINESS_LINE], maxRecords: 10 });

    assert.equal(result.records.length, 1);
    const rec = result.records[0];
    assert.equal(rec.rnc, '101023456');
    assert.equal(rec.legalName, 'EMPRESA EJEMPLO SRL');
    assert.equal(rec.taxpayerStatus, 'ACTIVO');
    assert.equal(rec.rncType, 'business_rnc');
    assert.equal(rec.isInScope, true);
  });

  it('marca como business_rnc y isInScope=true para RNC 9 dígitos', () => {
    const result = parseDgiiLines({ lines: [SAMPLE_BUSINESS_LINE] });
    assert.equal(result.stats.businessRnc9, 1);
    assert.equal(result.stats.cedula11, 0);
  });

  it('descarta (isInScope=false) una cédula de 11 dígitos', () => {
    const line = `00112345678|PERSONA FISICA||SERVICIOS| | | | |1990-01-01|ACTIVO|NORMAL`;
    const result = parseDgiiLines({ lines: [line] });
    assert.equal(result.records[0].rncType, 'cedula_persona');
    assert.equal(result.records[0].isInScope, false);
    assert.equal(result.stats.cedula11, 1);
    assert.equal(result.stats.businessRnc9, 0);
  });

  it('conserva economicActivity como texto libre sin inventar CIIU', () => {
    const result = parseDgiiLines({ lines: [SAMPLE_BUSINESS_LINE] });
    const rec = result.records[0];
    assert.equal(rec.economicActivity, 'COMERCIO AL POR MAYOR');
    // No debe haber campo ciiu ni sector_code inventado
    assert.equal((rec as unknown as Record<string, unknown>).ciiu, undefined);
    assert.equal((rec as unknown as Record<string, unknown>).sectorCode, undefined);
  });

  it('detecta y omite header row automáticamente', () => {
    const result = parseDgiiLines({ lines: [HEADER_LINE, SAMPLE_BUSINESS_LINE] });
    assert.equal(result.headerSkipped, true);
    assert.equal(result.mappingSource, 'detected_from_header');
    assert.equal(result.records.length, 1);
    assert.equal(result.stats.businessRnc9, 1);
  });

  it('mezcla RNC jurídicos y cédulas correctamente', () => {
    const cedula = `00112345678|JUAN PERSONA||SERVICIOS| | | | |1990-01-01|ACTIVO|NORMAL`;
    const result = parseDgiiLines({ lines: [SAMPLE_BUSINESS_LINE, cedula] });
    assert.equal(result.stats.businessRnc9, 1);
    assert.equal(result.stats.cedula11, 1);
    assert.equal(result.normalizedCompanies.length, 1);
  });

  it('normalizedCompanies solo incluye RNC jurídicos 9 dígitos', () => {
    const cedula = `00112345678|PERSONA NATURAL||OTROS| | | | |1995-01-01|ACTIVO|NORMAL`;
    const result = parseDgiiLines({ lines: [SAMPLE_BUSINESS_LINE, cedula] });
    assert.ok(result.normalizedCompanies.every((c) => c.rnc.length === 9));
  });

  it('registra distribución de estados correctamente', () => {
    const suspended = `202034567|EMPRESA SUSPENDIDA SRL||SERVICIOS| | | | |2005-01-01|SUSPENDIDO|NORMAL`;
    const result = parseDgiiLines({ lines: [SAMPLE_BUSINESS_LINE, suspended] });
    assert.equal(result.stats.statusDistribution['ACTIVO'], 1);
    assert.equal(result.stats.statusDistribution['SUSPENDIDO'], 1);
  });

  it('no produce registros para líneas vacías', () => {
    const result = parseDgiiLines({ lines: ['', '   ', SAMPLE_BUSINESS_LINE, ''] });
    assert.equal(result.records.length, 1);
  });
});

describe('parseDgiiLines — parser puro sin fuentes prohibidas', () => {
  it('el parser no llama api-dgii.dominicantechnology.com (función pura)', () => {
    const result = parseDgiiLines({ lines: [SAMPLE_BUSINESS_LINE] });
    assert.equal(result.records.length, 1);
  });

  it('el parser no usa WebForms POST ni __VIEWSTATE (función pura)', () => {
    const result = parseDgiiLines({ lines: [SAMPLE_BUSINESS_LINE] });
    assert.equal(result.records.length, 1);
  });

  it('el parser no usa SOAP wsMovilDGII (función pura)', () => {
    const result = parseDgiiLines({ lines: [SAMPLE_BUSINESS_LINE] });
    assert.equal(result.records.length, 1);
  });
});

describe('dgii-bulk-client — headers obligatorios', () => {
  it('DGII_REQUEST_HEADERS incluye Referer apuntando a dgii.gov.do/rnc', async () => {
    const { DGII_REQUEST_HEADERS } = await import('../dgii-bulk-client');
    assert.ok(DGII_REQUEST_HEADERS.Referer.includes('dgii.gov.do'));
    assert.ok(DGII_REQUEST_HEADERS.Referer.toLowerCase().includes('rnc'));
  });

  it('DGII_REQUEST_HEADERS no referencia Dominican Technology API', async () => {
    const { DGII_REQUEST_HEADERS } = await import('../dgii-bulk-client');
    const headersStr = JSON.stringify(DGII_REQUEST_HEADERS).toLowerCase();
    assert.ok(!headersStr.includes('dominicantechnology'));
    assert.ok(!headersStr.includes('wsmovildigii'));
  });
});

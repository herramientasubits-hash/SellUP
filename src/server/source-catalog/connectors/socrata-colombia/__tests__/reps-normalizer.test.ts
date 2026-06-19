/**
 * Tests — REPS Normalizer + Deduplicación (Hardening 16AB)
 *
 * Fixtures locales únicamente — sin red, sin Supabase.
 * Usa Node.js built-in test runner (node:test + node:assert).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRepsRecord } from '../normalizers';
import { dedupeRepsRecordsByProvider } from '../reps-helpers';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

type RawRecord = Record<string, unknown>;

function makeRepsRow(overrides: RawRecord = {}): RawRecord {
  return {
    numeroidentificacion: '900123456',
    nombreprestador: 'CLINICA SALUD TOTAL SAS',
    codigoprestador: 'COD001',
    tipoid: 'NI',
    claseprestador: 'Institución Prestadora de Servicios de Salud',
    naturalezajuridica: 'Privada',
    ese: 'No',
    departamentoprestadordesc: 'Antioquia',
    municipioprestadordesc: 'Medellín',
    direccionprestador: 'CRA 50 # 45-20',
    email_prestador: 'contacto@clinicasalud.com',
    telefonoprestador: '6042345678',
    codigohabilitacionsede: 'SEDE01CLINICA',
    nombresede: 'Sede Principal',
    direcci_nsede: 'CRA 50 # 45-20',
    email_sede: 'sede@clinicasalud.com',
    t_lefonosede: '6042345679',
    ...overrides,
  };
}

// ─── Tests del normalizer ─────────────────────────────────────────────────────

describe('normalizeRepsRecord — campos básicos', () => {
  it('companyName viene de nombreprestador', () => {
    const result = normalizeRepsRecord(makeRepsRow());
    assert.equal(result.companyName, 'CLINICA SALUD TOTAL SAS');
  });

  it('taxId viene de numeroidentificacion', () => {
    const result = normalizeRepsRecord(makeRepsRow());
    assert.equal(result.taxId, '900123456');
  });

  it('source y sourceKey son correctos para REPS', () => {
    const result = normalizeRepsRecord(makeRepsRow());
    assert.equal(result.source, 'reps');
    assert.equal(result.sourceKey, 'co_minsalud_reps');
    assert.equal(result.datasetId, 'c36g-9fc2');
  });
});

describe('normalizeRepsRecord — campos inexistentes eliminados', () => {
  it('legalStatus es null (no usa record.estado que no existe)', () => {
    // Aunque se pase 'estado' en el raw, debe ignorarse
    const result = normalizeRepsRecord(
      makeRepsRow({ estado: 'ACTIVO', tipoprestador: 'HOSPITAL' }),
    );
    assert.equal(result.legalStatus, null);
  });

  it('sectorDescription no usa tipoprestador (campo inexistente)', () => {
    const result = normalizeRepsRecord(
      makeRepsRow({ tipoprestador: 'TIPO_FALSO' }),
    );
    assert.notEqual(result.sectorDescription, 'TIPO_FALSO');
  });
});

describe('normalizeRepsRecord — claseprestador como tipo sectorial', () => {
  it('sectorCode viene de claseprestador', () => {
    const result = normalizeRepsRecord(makeRepsRow());
    assert.equal(result.sectorCode, 'Institución Prestadora de Servicios de Salud');
  });

  it('sectorDescription viene de claseprestador', () => {
    const result = normalizeRepsRecord(makeRepsRow());
    assert.equal(result.sectorDescription, 'Institución Prestadora de Servicios de Salud');
  });

  it('metadata.provider_class refleja claseprestador', () => {
    const result = normalizeRepsRecord(makeRepsRow());
    assert.equal(result.sourceMetadata.provider_class, 'Institución Prestadora de Servicios de Salud');
  });
});

describe('normalizeRepsRecord — protección datos personales tipoid', () => {
  it('tipoid NI: email y teléfono se exponen como datos principales', () => {
    const result = normalizeRepsRecord(makeRepsRow({ tipoid: 'NI' }));
    assert.equal(result.email, 'contacto@clinicasalud.com');
    assert.equal(result.phone, '6042345678');
    assert.equal(result.sourceMetadata.personal_data_guard_applied, undefined);
  });

  it('tipoid CC: email principal es null (personal data guard)', () => {
    const result = normalizeRepsRecord(makeRepsRow({ tipoid: 'CC' }));
    assert.equal(result.email, null);
  });

  it('tipoid CC: teléfono principal es null (personal data guard)', () => {
    const result = normalizeRepsRecord(makeRepsRow({ tipoid: 'CC' }));
    assert.equal(result.phone, null);
  });

  it('tipoid CC: personal_data_guard_applied = true en metadata', () => {
    const result = normalizeRepsRecord(makeRepsRow({ tipoid: 'CC' }));
    assert.equal(result.sourceMetadata.personal_data_guard_applied, true);
  });

  it('tipoid CC: personal_data_guard_reason en metadata', () => {
    const result = normalizeRepsRecord(makeRepsRow({ tipoid: 'CC' }));
    assert.equal(
      result.sourceMetadata.personal_data_guard_reason,
      'non_corporate_identifier',
    );
  });

  it('tipoid ausente: aplica guard (no es NI)', () => {
    const result = normalizeRepsRecord(makeRepsRow({ tipoid: undefined }));
    assert.equal(result.email, null);
    assert.equal(result.sourceMetadata.personal_data_guard_applied, true);
  });
});

describe('normalizeRepsRecord — codigohabilitacionsede como sede, no como identidad', () => {
  it('rawRecordId es prestador-level (nit__codigoprestador), no codigohabilitacionsede', () => {
    const result = normalizeRepsRecord(makeRepsRow());
    assert.equal(result.rawRecordId, '900123456__COD001');
    // codigohabilitacionsede NO debe aparecer en rawRecordId
    assert.ok(!result.rawRecordId?.includes('SEDE01CLINICA'));
  });

  it('codigohabilitacionsede queda en metadata.reps_site_code', () => {
    const result = normalizeRepsRecord(makeRepsRow());
    assert.equal(result.sourceMetadata.reps_site_code, 'SEDE01CLINICA');
  });

  it('metadata de sede se mapea correctamente', () => {
    const result = normalizeRepsRecord(makeRepsRow());
    assert.equal(result.sourceMetadata.site_name, 'Sede Principal');
    assert.equal(result.sourceMetadata.site_email, 'sede@clinicasalud.com');
    assert.equal(result.sourceMetadata.site_phone, '6042345679');
  });
});

describe('normalizeRepsRecord — campos faltantes no rompen el normalizer', () => {
  it('registro vacío devuelve objeto válido con nulls', () => {
    const result = normalizeRepsRecord({});
    assert.equal(result.companyName, null);
    assert.equal(result.taxId, null);
    assert.equal(result.rawRecordId, null);
    assert.equal(result.legalStatus, null);
    assert.equal(result.email, null);
    assert.equal(result.phone, null);
  });

  it('sin codigoprestador: rawRecordId cae a nit solo', () => {
    const result = normalizeRepsRecord(
      makeRepsRow({ codigoprestador: undefined }),
    );
    assert.equal(result.rawRecordId, '900123456');
  });

  it('sin nit y sin codigoprestador: rawRecordId es null', () => {
    const result = normalizeRepsRecord({
      nombreprestador: 'PRESTADOR SIN ID',
      codigohabilitacionsede: 'SEDE99',
    });
    assert.equal(result.rawRecordId, null);
  });
});

// ─── Tests del helper de deduplicación ───────────────────────────────────────

describe('dedupeRepsRecordsByProvider — agrupación por NIT', () => {
  it('dos filas con mismo NIT y diferentes sedes producen un solo prestador', () => {
    const sede1 = normalizeRepsRecord(
      makeRepsRow({ codigohabilitacionsede: 'SEDE01', nombresede: 'Sede Norte' }),
    );
    const sede2 = normalizeRepsRecord(
      makeRepsRow({ codigohabilitacionsede: 'SEDE02', nombresede: 'Sede Sur' }),
    );
    const result = dedupeRepsRecordsByProvider([sede1, sede2]);
    assert.equal(result.length, 1);
  });

  it('deduplicación produce entidad con total_sites correcto', () => {
    const sede1 = normalizeRepsRecord(makeRepsRow({ codigohabilitacionsede: 'SEDE01' }));
    const sede2 = normalizeRepsRecord(makeRepsRow({ codigohabilitacionsede: 'SEDE02' }));
    const sede3 = normalizeRepsRecord(makeRepsRow({ codigohabilitacionsede: 'SEDE03' }));
    const [provider] = dedupeRepsRecordsByProvider([sede1, sede2, sede3]);
    assert.equal(provider.total_sites, 3);
  });

  it('sites[] contiene una entrada por sede', () => {
    const sede1 = normalizeRepsRecord(
      makeRepsRow({ codigohabilitacionsede: 'SEDE01', nombresede: 'Norte' }),
    );
    const sede2 = normalizeRepsRecord(
      makeRepsRow({ codigohabilitacionsede: 'SEDE02', nombresede: 'Sur' }),
    );
    const [provider] = dedupeRepsRecordsByProvider([sede1, sede2]);
    assert.equal(provider.sites.length, 2);
    const siteCodes = provider.sites.map((s) => s.site_code);
    assert.ok(siteCodes.includes('SEDE01'));
    assert.ok(siteCodes.includes('SEDE02'));
  });

  it('NITs distintos producen entidades distintas', () => {
    const prestadorA = normalizeRepsRecord(
      makeRepsRow({ numeroidentificacion: '111111111', codigoprestador: 'PA' }),
    );
    const prestadorB = normalizeRepsRecord(
      makeRepsRow({ numeroidentificacion: '222222222', codigoprestador: 'PB' }),
    );
    const result = dedupeRepsRecordsByProvider([prestadorA, prestadorB]);
    assert.equal(result.length, 2);
  });

  it('departments y municipalities se agregan por sedes', () => {
    const sede1 = normalizeRepsRecord(
      makeRepsRow({ departamentoprestadordesc: 'Antioquia', municipioprestadordesc: 'Medellín' }),
    );
    const sede2 = normalizeRepsRecord(
      makeRepsRow({ departamentoprestadordesc: 'Cundinamarca', municipioprestadordesc: 'Bogotá' }),
    );
    const [provider] = dedupeRepsRecordsByProvider([sede1, sede2]);
    assert.ok(provider.departments.includes('Antioquia'));
    assert.ok(provider.departments.includes('Cundinamarca'));
    assert.ok(provider.municipalities.includes('Medellín'));
    assert.ok(provider.municipalities.includes('Bogotá'));
  });

  it('registro sin NIT ni rawRecordId no rompe la deduplicación', () => {
    const sinId = normalizeRepsRecord({
      nombreprestador: 'PRESTADOR SIN IDENTIFICACION',
    });
    const normal = normalizeRepsRecord(makeRepsRow());
    const result = dedupeRepsRecordsByProvider([sinId, normal]);
    assert.equal(result.length, 2);
  });
});

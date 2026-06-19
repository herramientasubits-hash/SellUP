/**
 * Tests — Superfinanciera Normalizer (Hardening 16AB)
 *
 * Valida que normalizeSuperfinancieraRecord() solo use campos reales del
 * dataset sr9n-792w y rechace los campos inexistentes documentados en el
 * diagnóstico técnico.
 *
 * Fixtures locales únicamente — sin red, sin Supabase.
 * Usa Node.js built-in test runner (node:test + node:assert).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSuperfinancieraRecord,
  mapSuperfinancieraEntityType,
  normalizeSuperfinancieraWebsite,
} from '../normalizers';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

type RawRecord = Record<string, unknown>;

function makeSfcRow(overrides: RawRecord = {}): RawRecord {
  return {
    numeroidentificacion: '860034313',
    razon_social: 'BANCO DE BOGOTA SA',
    tipo_entidad: 'EST. CRED.',
    cod_entidad: '2',
    ciudad: 'BOGOTA D.C.',
    direccion: 'CALLE 36 # 7-47',
    emailprincipal: 'contacto@bancodebogota.com.co',
    uripaginaweb: 'https://www.bancodebogota.com.co',
    representante_legal: 'ALEJANDRO FIGUEROA JARAMILLO',
    nombrepublicocargo: 'PRESIDENTE',
    ...overrides,
  };
}

// ─── Campos básicos ───────────────────────────────────────────────────────────

describe('normalizeSuperfinancieraRecord — campos básicos', () => {
  it('companyName viene de razon_social', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(result.companyName, 'BANCO DE BOGOTA SA');
  });

  it('taxId viene de numeroidentificacion', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(result.taxId, '860034313');
  });

  it('source, sourceKey y datasetId son correctos', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(result.source, 'superfinanciera');
    assert.equal(result.sourceKey, 'co_superfinanciera');
    assert.equal(result.datasetId, 'sr9n-792w');
  });
});

// ─── rawRecordId ──────────────────────────────────────────────────────────────

describe('normalizeSuperfinancieraRecord — rawRecordId', () => {
  it('rawRecordId usa cod_entidad como fuente principal', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(result.rawRecordId, '2');
  });

  it('rawRecordId cae a numeroidentificacion si cod_entidad falta', () => {
    const result = normalizeSuperfinancieraRecord(
      makeSfcRow({ cod_entidad: undefined }),
    );
    assert.equal(result.rawRecordId, '860034313');
  });

  it('rawRecordId no usa record.id (campo inexistente)', () => {
    const result = normalizeSuperfinancieraRecord(
      makeSfcRow({ id: 'FAKE_ID' }),
    );
    assert.notEqual(result.rawRecordId, 'FAKE_ID');
  });

  it('rawRecordId no usa record.codigo_entidad (campo inexistente)', () => {
    const result = normalizeSuperfinancieraRecord(
      makeSfcRow({ codigo_entidad: 'FAKE_CODIGO' }),
    );
    assert.notEqual(result.rawRecordId, 'FAKE_CODIGO');
  });
});

// ─── Campos inexistentes eliminados ──────────────────────────────────────────

describe('normalizeSuperfinancieraRecord — campos inexistentes no se usan', () => {
  it('legalStatus es null (no usa record.estado)', () => {
    const result = normalizeSuperfinancieraRecord(
      makeSfcRow({ estado: 'ACTIVA' }),
    );
    assert.equal(result.legalStatus, null);
  });

  it('sectorDescription no usa record.actividad_economica', () => {
    const result = normalizeSuperfinancieraRecord(
      makeSfcRow({ actividad_economica: '6412' }),
    );
    assert.notEqual(result.sectorDescription, '6412');
  });

  it('department es null (no usa record.departamento)', () => {
    const result = normalizeSuperfinancieraRecord(
      makeSfcRow({ departamento: 'CUNDINAMARCA' }),
    );
    assert.equal(result.department, null);
  });

  it('phone es null (no usa record.telefono)', () => {
    const result = normalizeSuperfinancieraRecord(
      makeSfcRow({ telefono: '6012345678' }),
    );
    assert.equal(result.phone, null);
  });
});

// ─── Website ──────────────────────────────────────────────────────────────────

describe('normalizeSuperfinancieraWebsite', () => {
  it('retorna null si uripaginaweb es "Pendiente"', () => {
    assert.equal(normalizeSuperfinancieraWebsite('Pendiente'), null);
  });

  it('retorna null si uripaginaweb es "pendiente" (minúsculas)', () => {
    assert.equal(normalizeSuperfinancieraWebsite('pendiente'), null);
  });

  it('retorna null si uripaginaweb es "PENDIENTE" (mayúsculas)', () => {
    assert.equal(normalizeSuperfinancieraWebsite('PENDIENTE'), null);
  });

  it('retorna null si uripaginaweb es null', () => {
    assert.equal(normalizeSuperfinancieraWebsite(null), null);
  });

  it('retorna null si uripaginaweb es texto libre sin URL', () => {
    assert.equal(normalizeSuperfinancieraWebsite('Sin información'), null);
  });

  it('preserva URL https válida', () => {
    assert.equal(
      normalizeSuperfinancieraWebsite('https://www.bancodebogota.com.co'),
      'https://www.bancodebogota.com.co',
    );
  });

  it('preserva URL http válida', () => {
    assert.equal(
      normalizeSuperfinancieraWebsite('http://www.ejemplo.com.co'),
      'http://www.ejemplo.com.co',
    );
  });

  it('agrega https:// a dominio www.', () => {
    assert.equal(
      normalizeSuperfinancieraWebsite('www.ejemplo.com.co'),
      'https://www.ejemplo.com.co',
    );
  });
});

describe('normalizeSuperfinancieraRecord — website integrado', () => {
  it('website es null si uripaginaweb es "Pendiente"', () => {
    const result = normalizeSuperfinancieraRecord(
      makeSfcRow({ uripaginaweb: 'Pendiente' }),
    );
    assert.equal(result.website, null);
  });

  it('website se preserva si es URL válida', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(result.website, 'https://www.bancodebogota.com.co');
  });
});

// ─── Email ────────────────────────────────────────────────────────────────────

describe('normalizeSuperfinancieraRecord — email', () => {
  it('email se conserva si parece institucional válido', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(result.email, 'contacto@bancodebogota.com.co');
  });

  it('email es null si emailprincipal falta', () => {
    const result = normalizeSuperfinancieraRecord(
      makeSfcRow({ emailprincipal: undefined }),
    );
    assert.equal(result.email, null);
  });

  it('email es null si emailprincipal está vacío', () => {
    const result = normalizeSuperfinancieraRecord(
      makeSfcRow({ emailprincipal: '   ' }),
    );
    assert.equal(result.email, null);
  });
});

// ─── tipo_entidad y metadata ──────────────────────────────────────────────────

describe('normalizeSuperfinancieraRecord — tipo_entidad en metadata', () => {
  it('sfc_entity_type_code guarda el código de tipo_entidad', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(result.sourceMetadata.sfc_entity_type_code, 'EST. CRED.');
  });

  it('sectorCode refleja tipo_entidad', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(result.sectorCode, 'EST. CRED.');
  });

  it('sfc_entity_type_label es etiqueta descriptiva no inventada', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(
      result.sourceMetadata.sfc_entity_type_label,
      'Entidad vigilada SFC - tipo EST. CRED.',
    );
  });

  it('sfc_supervised_entity es true', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(result.sourceMetadata.sfc_supervised_entity, true);
  });

  it('source_dataset_id es sr9n-792w', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(result.sourceMetadata.source_dataset_id, 'sr9n-792w');
  });
});

// ─── Representante legal en metadata ─────────────────────────────────────────

describe('normalizeSuperfinancieraRecord — representante legal en metadata', () => {
  it('legal_representative_name viene de representante_legal', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(
      result.sourceMetadata.legal_representative_name,
      'ALEJANDRO FIGUEROA JARAMILLO',
    );
  });

  it('legal_representative_role viene de nombrepublicocargo', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(result.sourceMetadata.legal_representative_role, 'PRESIDENTE');
  });

  it('sfc_entity_code viene de cod_entidad', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(result.sourceMetadata.sfc_entity_code, '2');
  });
});

// ─── Entidad extranjera (numeroidentificacion = '0') ─────────────────────────

describe('normalizeSuperfinancieraRecord — entidad extranjera', () => {
  it('numeroidentificacion 0 marca foreign_entity_without_colombian_tax_id', () => {
    const result = normalizeSuperfinancieraRecord(
      makeSfcRow({ numeroidentificacion: '0' }),
    );
    assert.equal(
      result.sourceMetadata.foreign_entity_without_colombian_tax_id,
      true,
    );
  });

  it('taxId es null para entidad extranjera (no tratar 0 como NIT válido)', () => {
    const result = normalizeSuperfinancieraRecord(
      makeSfcRow({ numeroidentificacion: '0' }),
    );
    assert.equal(result.taxId, null);
  });

  it('NIT colombiano normal no tiene la marca de entidad extranjera', () => {
    const result = normalizeSuperfinancieraRecord(makeSfcRow());
    assert.equal(
      result.sourceMetadata.foreign_entity_without_colombian_tax_id,
      undefined,
    );
  });
});

// ─── Campos faltantes no rompen el normalizer ─────────────────────────────────

describe('normalizeSuperfinancieraRecord — robustez ante campos faltantes', () => {
  it('registro vacío devuelve objeto válido con nulls', () => {
    const result = normalizeSuperfinancieraRecord({});
    assert.equal(result.companyName, null);
    assert.equal(result.taxId, null);
    assert.equal(result.rawRecordId, null);
    assert.equal(result.legalStatus, null);
    assert.equal(result.phone, null);
    assert.equal(result.department, null);
  });

  it('sin cod_entidad ni numeroidentificacion: rawRecordId es null', () => {
    const result = normalizeSuperfinancieraRecord({
      razon_social: 'ENTIDAD SIN ID',
    });
    assert.equal(result.rawRecordId, null);
  });

  it('tipo_entidad ausente: sectorCode es null y sectorDescription es null', () => {
    const result = normalizeSuperfinancieraRecord(
      makeSfcRow({ tipo_entidad: undefined }),
    );
    assert.equal(result.sectorCode, null);
    assert.equal(result.sectorDescription, null);
  });
});

// ─── mapSuperfinancieraEntityType ────────────────────────────────────────────

describe('mapSuperfinancieraEntityType', () => {
  it('retorna null para código null', () => {
    assert.equal(mapSuperfinancieraEntityType(null), null);
  });

  it('retorna etiqueta descriptiva para código conocido', () => {
    assert.equal(
      mapSuperfinancieraEntityType('EST. CRED.'),
      'Entidad vigilada SFC - tipo EST. CRED.',
    );
  });

  it('retorna etiqueta descriptiva para código desconocido', () => {
    assert.equal(
      mapSuperfinancieraEntityType('TIPO_NUEVO'),
      'Entidad vigilada SFC - tipo TIPO_NUEVO',
    );
  });
});

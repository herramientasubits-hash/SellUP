/**
 * Socrata Colombia Connector — Normalizers
 *
 * Un normalizador por dataset. Mapea campos conocidos al tipo común.
 * No guarda raw completo. No incluye PII innecesaria.
 * Los campos pueden variar por dataset — se accede con coerción segura.
 */

import { SOCRATA_COLOMBIA_DATASETS } from './datasets';
import type { NormalizedColombiaCompanySample } from './types';

type RawRecord = Record<string, unknown>;

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
}

// ─── RUES / Registro Mercantil ────────────────────────────────────────────────

export function normalizeRuesRecord(
  record: RawRecord,
): NormalizedColombiaCompanySample {
  const meta = SOCRATA_COLOMBIA_DATASETS.rues;
  return {
    source: 'rues',
    sourceKey: meta.sourceKey,
    datasetId: meta.datasetId,
    companyName: str(record.razon_social),
    taxId: str(record.numero_identificacion),
    legalStatus: str(record.estado_matricula),
    sectorCode: str(record.cod_ciiu_act_econ_pri),
    sectorDescription: null,
    city: null,
    department: null,
    address: null,
    email: null,
    phone: null,
    website: null,
    rawRecordId: str(record.matricula),
    sourceMetadata: {
      organizacion_juridica: str(record.organizacion_juridica),
      camara_comercio: str(record.camara_comercio),
      tipo_sociedad: str(record.tipo_sociedad),
    },
  };
}

// ─── SECOP Integrado ──────────────────────────────────────────────────────────

export function normalizeSecopRecord(
  record: RawRecord,
): NormalizedColombiaCompanySample {
  const meta = SOCRATA_COLOMBIA_DATASETS.secop2;
  return {
    source: 'secop2',
    sourceKey: meta.sourceKey,
    datasetId: meta.datasetId,
    companyName: str(record.nom_raz_social_contratista),
    taxId: str(record.documento_proveedor),
    legalStatus: null,
    sectorCode: null,
    sectorDescription: str(record.objeto_a_contratar),
    city: str(record.municipio_entidad),
    department: str(record.departamento_entidad),
    address: null,
    email: null,
    phone: null,
    website: null,
    rawRecordId: str(record.id_contrato) ?? str(record.referencia_del_contrato),
    sourceMetadata: {
      tipo_documento_proveedor: str(record.tipo_documento_proveedor),
      valor_contrato: typeof record.valor_contrato === 'number' ? record.valor_contrato : null,
      entidad_contratante: str(record.nombre_entidad),
    },
  };
}

// ─── REPS MinSalud ────────────────────────────────────────────────────────────

export function normalizeRepsRecord(
  record: RawRecord,
): NormalizedColombiaCompanySample {
  const meta = SOCRATA_COLOMBIA_DATASETS.reps;
  return {
    source: 'reps',
    sourceKey: meta.sourceKey,
    datasetId: meta.datasetId,
    companyName: str(record.nombreprestador),
    taxId: str(record.numeroidentificacion),
    legalStatus: str(record.estado),
    sectorCode: str(record.claseprestador),
    sectorDescription: str(record.tipoprestador),
    city: str(record.municipioprestadordesc),
    department: str(record.departamentoprestadordesc),
    address: str(record.direccionprestador),
    email: str(record.email_prestador),
    phone: str(record.telefonoprestador),
    website: null,
    rawRecordId: str(record.codigoprestador) ?? str(record.id),
    sourceMetadata: {
      naturaleza_juridica: str(record.naturalezajuridica),
      tipo_id: str(record.tipoid),
      clase_prestador: str(record.claseprestador),
    },
  };
}

// ─── Superfinanciera ──────────────────────────────────────────────────────────

export function normalizeSuperfinancieraRecord(
  record: RawRecord,
): NormalizedColombiaCompanySample {
  const meta = SOCRATA_COLOMBIA_DATASETS.superfinanciera;
  return {
    source: 'superfinanciera',
    sourceKey: meta.sourceKey,
    datasetId: meta.datasetId,
    companyName: str(record.razon_social),
    taxId: str(record.numeroidentificacion) ?? str(record.nit),
    legalStatus: str(record.estado),
    sectorCode: str(record.tipo_entidad),
    sectorDescription: str(record.actividad_economica),
    city: str(record.ciudad),
    department: str(record.departamento),
    address: str(record.direccion),
    email: str(record.emailprincipal),
    phone: str(record.telefono),
    website: str(record.uripaginaweb),
    rawRecordId: str(record.id) ?? str(record.codigo_entidad),
    sourceMetadata: {
      representante_legal: str(record.representante_legal),
    },
  };
}

/**
 * Socrata Colombia Connector — Dataset Registry
 *
 * Registro de datasets públicos de datos.gov.co identificados en auditoría 16AB.1.
 * Las URLs base son fijas — no se construyen desde input externo.
 */

import type { ColombiaCompanySource } from './types';

export type SocrataColombiaDataset = {
  sourceKey: string;
  datasetId: string;
  name: string;
  baseUrl: string;
  primaryUse: string;
};

export const SOCRATA_COLOMBIA_DATASETS = {
  rues: {
    sourceKey: 'co_rues',
    datasetId: 'c82u-588k',
    name: 'RUES / Registro Mercantil',
    baseUrl: 'https://www.datos.gov.co/resource/c82u-588k.json',
    primaryUse: 'company_discovery',
  },
  secop2: {
    sourceKey: 'co_secop2',
    datasetId: 'rpmr-utcd',
    name: 'SECOP Integrado',
    baseUrl: 'https://www.datos.gov.co/resource/rpmr-utcd.json',
    primaryUse: 'b2g_signal',
  },
  reps: {
    sourceKey: 'co_minsalud_reps',
    datasetId: 'c36g-9fc2',
    name: 'REPS MinSalud',
    baseUrl: 'https://www.datos.gov.co/resource/c36g-9fc2.json',
    primaryUse: 'health_discovery',
  },
  superfinanciera: {
    sourceKey: 'co_superfinanciera',
    datasetId: 'sr9n-792w',
    name: 'Superfinanciera',
    baseUrl: 'https://www.datos.gov.co/resource/sr9n-792w.json',
    primaryUse: 'financial_sector_discovery',
  },
  secop2_proveedores: {
    sourceKey: 'co_secop2_proveedores',
    datasetId: 'qmzu-gj57',
    name: 'SECOP II Proveedores Registrados',
    baseUrl: 'https://www.datos.gov.co/resource/qmzu-gj57.json',
    primaryUse: 'b2g_enrichment',
  },
} as const satisfies Record<ColombiaCompanySource, SocrataColombiaDataset>;

export const SOCRATA_COLOMBIA_DATASET_KEYS = Object.keys(
  SOCRATA_COLOMBIA_DATASETS,
) as ColombiaCompanySource[];

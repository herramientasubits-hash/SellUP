/**
 * Chile — órdenes de compra mensuales de ChileCompra (datos abiertos), cargadas en
 * `public_procurement_supplier_links` con `scripts/source-catalog/run-cl-chilecompra-orders-load.ts`.
 * Industria por UNSPSC (tabla aprobada); web casi nunca (lista curada); trabajadores del SII.
 */

import { CL_CHILECOMPRA_MIN_PAIR_AMOUNT_CLP, CL_CHILECOMPRA_ORDERS_SOURCE_KEY, normalizeClBuyerName } from '../cl-chilecompra-orders';
import { UNSPSC_CLASSIFIER } from '../unspsc-classifier';
import type { LoadedCountrySource } from './types';

export const CL_COUNTRY: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'CL',
  sourceKey: CL_CHILECOMPRA_ORDERS_SOURCE_KEY,
  taxIdentifierType: 'RUT',
  currency: 'CLP',
  minPairAmount: CL_CHILECOMPRA_MIN_PAIR_AMOUNT_CLP,
  normalizeBuyerName: normalizeClBuyerName,
  classifier: UNSPSC_CLASSIFIER,
  domainSourceKeys: ['latam_curated_directory'],
  workersSourceKeys: ['cl_sii_directory', 'cl_sii_registry'],
  workersSourceLabel: 'SII',
  // La lista curada guarda el RUT sin guion («70015730K»); el SII, con guion.
  snapshotTaxIdForms: (rut) => [rut, rut.replace('-', '')],
};

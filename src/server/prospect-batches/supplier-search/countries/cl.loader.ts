/**
 * Chile — lector de las órdenes de compra mensuales de ChileCompra para el cargador
 * genérico (`scripts/source-catalog/run-public-procurement-load.ts --country CL`).
 * Mismas reglas que `cl-chilecompra-orders.ts`: órdenes vigentes, sólo RUT de empresa.
 */

import { CL_CHILECOMPRA_ORDERS_URL, clOrderUrl, isClCompanyRut, parseClAmount, parseClRut } from '../cl-chilecompra-orders';
import { unspscFamily } from '../unspsc-classifier';
import { CL_COUNTRY } from './cl';
import { monthsBack, readZipCsv } from './loader-io';
import type { ProcurementLoaderSource } from './types';

const VALID_STATES = new Set(['recepcion conforme', 'aceptada', 'enviada a proveedor', 'en proceso']);

export const CL_LOADER: ProcurementLoaderSource = {
  country: CL_COUNTRY,
  files: (end, months) => monthsBack(end, months).map(({ year, month }) => ({ url: CL_CHILECOMPRA_ORDERS_URL(year, month), name: `cl-${year}-${month}.zip` })),
  readLines: (filePath, onLine) =>
    readZipCsv(filePath, { encoding: 'latin1', delimiter: ';' }, (r) => {
      if (!VALID_STATES.has((r['Estado'] ?? '').trim().toLowerCase())) return;
      const supplier = parseClRut(r['RutSucursal']);
      if (!supplier || !isClCompanyRut(supplier)) return;
      const buyerTax = parseClRut(r['RutUnidadCompra']);
      onLine({
        buyerCode: (r['CodigoOrganismoPublico'] ?? '').trim(),
        buyerName: (r['OrganismoPublico'] ?? '').trim(),
        buyerTaxId: buyerTax?.rut ?? null,
        buyerSector: (r['sector'] ?? '').trim() || null,
        supplierTaxId: supplier.rut,
        supplierName: (r['NombreProveedor'] ?? '').trim(),
        amount: parseClAmount(r['totalLineaNeto']),
        orderCode: (r['Codigo'] ?? '').trim(),
        orderUrl: clOrderUrl(r['Link']),
        date: (r['FechaEnvio'] || r['FechaCreacion'] || '').slice(0, 10) || null,
        classificationKey: unspscFamily(r['codigoProductoONU']),
      });
    }),
};

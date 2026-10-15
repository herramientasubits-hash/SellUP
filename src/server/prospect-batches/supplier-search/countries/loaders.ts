/**
 * Registro de lectores de los países «loaded» (sólo para el cargador genérico, Node).
 * Una línea por país.
 */

import { CL_LOADER } from './cl.loader';
import { AR_LOADER } from './ar.loader';
import { UY_LOADER } from './uy.loader';
import { ES_LOADER } from './es.loader';
import type { ProcurementLoaderSource } from './types';

export const PROCUREMENT_LOADERS: Readonly<Record<string, ProcurementLoaderSource>> = {
  CL: CL_LOADER,
  AR: AR_LOADER,
  UY: UY_LOADER,
  ES: ES_LOADER,
};

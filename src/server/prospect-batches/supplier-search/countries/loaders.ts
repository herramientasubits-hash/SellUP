/**
 * Registro de lectores de los países «loaded» (sólo para el cargador genérico, Node).
 * Una línea por país.
 */

import { CL_LOADER } from './cl.loader';
import { GT_LOADER } from './gt.loader';
import { HN_LOADER } from './hn.loader';
import { PE_LOADER } from './pe.loader';
import { PY_LOADER } from './py.loader';
import { PA_LOADER } from './pa.loader';
import type { ProcurementLoaderSource } from './types';

export const PROCUREMENT_LOADERS: Readonly<Record<string, ProcurementLoaderSource>> = {
  CL: CL_LOADER,
  PE: PE_LOADER,
  HN: HN_LOADER,
  GT: GT_LOADER,
  PY: PY_LOADER,
  PA: PA_LOADER,
};

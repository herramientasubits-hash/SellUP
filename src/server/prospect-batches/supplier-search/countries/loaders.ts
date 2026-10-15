/**
 * Registro de lectores de los países «loaded» (sólo para el cargador genérico, Node).
 * Una línea por país.
 */

import { CL_LOADER } from './cl.loader';
import { PA_LOADER } from './pa.loader';
import type { ProcurementLoaderSource } from './types';

export const PROCUREMENT_LOADERS: Readonly<Record<string, ProcurementLoaderSource>> = {
  CL: CL_LOADER,
  PA: PA_LOADER,
};

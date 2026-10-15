/**
 * Registro de lectores de los países «loaded» (sólo para el cargador genérico, Node).
 * Una línea por país.
 */

import { CL_LOADER } from './cl.loader';
import { HN_LOADER } from './hn.loader';
import { PE_LOADER } from './pe.loader';
import type { ProcurementLoaderSource } from './types';

export const PROCUREMENT_LOADERS: Readonly<Record<string, ProcurementLoaderSource>> = {
  CL: CL_LOADER,
  PE: PE_LOADER,
  HN: HN_LOADER,
};

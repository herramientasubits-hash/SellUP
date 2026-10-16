/**
 * Colombia — SECOP II en vivo por datos.gov.co (dataset jbjy-vk9h), filtrando por el NIT
 * de la entidad. Sus consultas están en `./co.server.ts`.
 *
 * El nombre de la entidad se normaliza con el núcleo colombiano: es el que se usó al cargar
 * `normalized_legal_name` de co_public_entities (`co-public-entity-rows.ts`). Así «Empresas
 * Públicas de Medellín E.S.P.» y «EMPRESAS PUBLICAS DE MEDELLIN» coinciden.
 */

import { normalizeColombiaCompanyNameCore } from '@/server/source-catalog/connectors/personas-juridicas-cc-colombia/co-company-name-core';
import { CO_SECOP_SUPPLIERS_SOURCE_KEY } from '../co-secop-suppliers';
import type { LiveCountrySource } from './types';

export const CO_COUNTRY: LiveCountrySource = {
  kind: 'live',
  countryCode: 'CO',
  sourceKey: CO_SECOP_SUPPLIERS_SOURCE_KEY,
  taxIdentifierType: 'NIT',
  normalizeBuyerName: (raw) => normalizeColombiaCompanyNameCore(raw),
};

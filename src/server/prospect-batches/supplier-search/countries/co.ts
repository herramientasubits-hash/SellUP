/**
 * Colombia — SECOP II en vivo por datos.gov.co (dataset jbjy-vk9h), filtrando por el NIT
 * de la entidad. Sus consultas están en `../public-buyer-suppliers.server.ts`.
 */

import { CO_SECOP_SUPPLIERS_SOURCE_KEY } from '../co-secop-suppliers';
import { normalizePublicEntityName } from '../public-buyer-suppliers';
import type { LiveCountrySource } from './types';

export const CO_COUNTRY: LiveCountrySource = {
  kind: 'live',
  countryCode: 'CO',
  sourceKey: CO_SECOP_SUPPLIERS_SOURCE_KEY,
  taxIdentifierType: 'NIT',
  normalizeBuyerName: normalizePublicEntityName,
};

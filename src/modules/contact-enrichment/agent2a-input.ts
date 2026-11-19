/**
 * Lo que el vendedor escribió para identificar la empresa (nombre, dominio, HubSpot ID o ficha
 * de SellUp), limpio y validado. La usan la acción de servidor y la ruta de la búsqueda de la
 * empresa (AGENT2-RESOLVE-COMPANY-ROUTE-1). Pura: lanza con un mensaje para el vendedor.
 */

import { parseCompanyPageUrl } from './company-page-url';
import type { Agent2AInput } from './types';

export function parseAgent2AInput(input: unknown): Agent2AInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Input inválido');
  }

  const raw = input as Record<string, unknown>;
  const result: Agent2AInput = {};

  if (typeof raw.companyName === 'string' && raw.companyName.trim()) {
    result.companyName = raw.companyName.trim();
  }
  if (typeof raw.companyDomain === 'string' && raw.companyDomain.trim()) {
    // Un enlace a la página de la empresa en LinkedIn (u otra red) no es su dominio: antes
    // `linkedin.com/company/cemaco` buscaba la empresa «LinkedIn» (feedback 19-11). Aporta
    // el nombre que dice su ruta y, si es de LinkedIn, el enlace.
    const page = parseCompanyPageUrl(raw.companyDomain);
    if (page) {
      if (page.nameGuess && !result.companyName) result.companyName = page.nameGuess;
      if (page.linkedinCompanyUrl) result.linkedinCompanyUrl = page.linkedinCompanyUrl;
    } else {
      result.companyDomain = raw.companyDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
    }
  }
  if (typeof raw.linkedinCompanyUrl === 'string' && raw.linkedinCompanyUrl.trim() && !result.linkedinCompanyUrl) {
    const page = parseCompanyPageUrl(raw.linkedinCompanyUrl);
    if (page?.linkedinCompanyUrl) result.linkedinCompanyUrl = page.linkedinCompanyUrl;
    if (page?.nameGuess && !result.companyName) result.companyName = page.nameGuess;
  }
  if (typeof raw.companyCountryCode === 'string' && raw.companyCountryCode.trim()) {
    result.companyCountryCode = raw.companyCountryCode.trim().toUpperCase();
  }
  if (typeof raw.hubspotCompanyId === 'string' && raw.hubspotCompanyId.trim()) {
    result.hubspotCompanyId = raw.hubspotCompanyId.trim();
  }
  if (typeof raw.sellupAccountId === 'string' && raw.sellupAccountId.trim()) {
    result.sellupAccountId = raw.sellupAccountId.trim();
  }

  const hasIdentifier =
    result.companyName ||
    result.companyDomain ||
    result.hubspotCompanyId ||
    result.sellupAccountId;

  if (!hasIdentifier) {
    throw new Error('Debes proveer al menos un identificador: nombre, dominio, HubSpot ID o SellUp Account ID');
  }

  return result;
}

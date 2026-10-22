// Agente 2A — filtro de empresa de Lusha Contact Prospecting (LUSHA-PROSPECTING-DOMAIN-ONLY-1)
//
// Medición Prod 21-10 (60 días): 76 búsquedas de Lusha cobraron 1 crédito y no dejaron
// candidatos. En 39 de ellas TODAS las personas devueltas eran de OTRO dominio, aunque la
// corrida tenía dominio. El runner mandaba `companies.include.names` + `.domains` juntos; Lusha
// no documenta si los combina con Y u O, y su soporte (15-10) dice que `names` espera el nombre
// CANÓNICO de Lusha, no el texto libre de SellUp («Laboratorio Instituto Sanitas®»).
//
// Con dominio, el nombre no puede aportar nada útil: después de la búsqueda el runner descarta
// toda persona cuyo dominio no sea EXACTAMENTE el de la empresa
// (`checkProspectingFqdnConsistency`). Así que mandar sólo el dominio no pierde ningún
// resultado que hoy se conserve, y si Lusha sumaba empresas por nombre, deja de cobrarlas.
// Sin dominio, el nombre sigue siendo el único filtro posible.

import { normalizeDomain } from './company-consistency-checker';

export interface LushaProspectingCompanyInclude {
  domains?: string[];
  names?: string[];
}

export function buildLushaProspectingCompanyInclude(
  companyName: string | null | undefined,
  companyDomain: string | null | undefined,
): LushaProspectingCompanyInclude {
  const domain = normalizeDomain(companyDomain);
  if (domain) return { domains: [domain] };
  const name = typeof companyName === 'string' ? companyName.trim() : '';
  return name ? { names: [name] } : {};
}

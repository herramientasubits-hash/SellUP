// AGENT2-APOLLO-PEOPLE-SEARCH-V2-1 — intentos de búsqueda de personas con el formato documentado
//
// Por qué existe: en los 60 días previos al 20-10, 111 de 193 búsquedas automáticas de
// Apollo terminaron sin UNA sola persona, aunque en casi todas Apollo había reconocido la
// empresa (organization_id). La versión anterior manda filtros que la búsqueda de personas
// no documenta —departamento de RR. HH., `q_organization_domains`, `q_organization_name`— y
// los manda en un cuerpo JSON en vez de en la URL.
//
// Estos intentos usan sólo filtros documentados y van de lo más preciso a lo más amplio:
//   1. la empresa + cargos de RR. HH. y decisores (con variantes) + el país;
//   2. lo mismo sin el país (el equipo de RR. HH. puede figurar en la sede regional);
//   3. la empresa + niveles de dirección, sin cargos (el clasificador decide quién sirve).
// Sin organization_id ni dominio no hay forma documentada de acotar la empresa: devuelve [] y
// el adaptador sigue con los intentos de siempre.
//
// Puro: sin red. Lo ejecuta `searchApolloPeopleForCompany` cuando la bandera está encendida.

import type { PeopleApiSearchQuery } from '@/server/integrations/apollo-client';

export interface PeopleSearchV2Plan {
  name: string;
  /** Filtros resumidos para el summary (sin volcar la consulta completa). */
  filters: string;
  query: PeopleApiSearchQuery;
}

/** Niveles de dirección para el intento amplio: quien decide o puede derivar a RR. HH. */
export const LEADERSHIP_SENIORITIES: readonly string[] = ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director'];

export function buildPeopleSearchV2Plans(input: {
  organizationId: string | null;
  companyDomain: string | null | undefined;
  personLocation: string | null;
  titles: readonly string[];
  perPage: number;
  maxAttempts: number;
}): PeopleSearchV2Plan[] {
  const orgId = input.organizationId?.trim() || null;
  const domain = input.companyDomain?.trim().toLowerCase() || null;
  if (!orgId && !domain) return [];

  const org: PeopleApiSearchQuery = orgId ? { organization_ids: [orgId] } : { q_organization_domains_list: [domain as string] };
  const orgDesc = orgId ? `org_id=${orgId}` : `dominio=${domain}`;
  const base: PeopleApiSearchQuery = { ...org, page: 1, per_page: input.perPage };
  const titles = { person_titles: [...input.titles], include_similar_titles: true };

  const plans: PeopleSearchV2Plan[] = [];
  if (input.personLocation) {
    plans.push({
      name: 'v2_hr_titles_country',
      filters: `v2; org(${orgDesc}); titles=HR+decisores (similares); location=${input.personLocation}`,
      query: { ...base, ...titles, person_locations: [input.personLocation] },
    });
  }
  plans.push(
    {
      name: 'v2_hr_titles_any_country',
      filters: `v2; org(${orgDesc}); titles=HR+decisores (similares); sin location`,
      query: { ...base, ...titles },
    },
    {
      name: 'v2_leadership',
      filters: `v2; org(${orgDesc}); seniorities=dirección; sin titles; sin location`,
      query: { ...base, person_seniorities: [...LEADERSHIP_SENIORITIES] },
    },
  );
  return plans.slice(0, input.maxAttempts);
}

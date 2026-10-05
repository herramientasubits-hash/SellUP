/**
 * AGENT1-LINKEDIN-OPTIONAL-INSTITUTIONS-1 — ¿se le exige LinkedIn a esta
 * organización para contar hacia la meta? (puro)
 *
 * Decisión de la dueña (01-10): obligatorio sólo donde tiene sentido. Entidades
 * del Estado, educación, ONG y gremios/cámaras son clientes UBITS (29-09) y muchas
 * no tienen página de empresa en LinkedIn; exigírsela dejaba fuera a clientes
 * reales (Prod 01-10: SIC 501+, Alcaldía de Córdoba Quindío 201+, Servicio de
 * Salud Coquimbo 201+). El tamaño se sigue exigiendo: esto sólo quita LinkedIn.
 *
 * Fail-closed: sin una señal clara se exige, como siempre.
 *   · dominio oficial del Estado o educativo: la señal más fuerte (sólo una
 *     institución puede registrar `.gov.co`, `.gob.mx`, `.edu.co`…);
 *   · ONG o gremio: por el nombre. Las palabras inequívocas valen con cualquier
 *     dominio; las ambiguas («corporación», «colegio de»…) sólo con `.org`.
 */

export type LinkedinRequirementReason = 'public_or_education_domain' | 'ngo_or_guild' | 'public_health_by_name';

export type LinkedinRequirement = {
  required: boolean;
  reason: LinkedinRequirementReason | null;
};

/** `.gov`, `.gob`, `.gub`, `.mil`, `.edu`, `.ac` (con o sin ccTLD) y `.go.cr`. */
const PUBLIC_OR_EDUCATION_DOMAIN = /(^|\.)((gov|gob|gub|mil|edu|ac)(\.[a-z]{2})?|go\.cr)$/;
const ORG_DOMAIN = /(^|\.)org(\.[a-z]{2})?$/;

const UNAMBIGUOUS_NGO_OR_GUILD = /\b(camara de comercio|camaras de comercio|federacion|confederacion|asociacion|gremio|fundacion|ong)\b/;
const AMBIGUOUS_NGO_OR_GUILD = /\b(corporacion|colegio de|consejo|sociedad|instituto|red de)\b/;
/**
 * AGENT1-TAVILY-HOSPITAL-LINKEDIN-1 — salud pública por el nombre (Prod 05-10,
 * CL×Salud a5227f3f: «Hospital Clínico San Borja Arriarán», 5.000 empleados,
 * dominio `hcsba.cl` y sin LinkedIn ⇒ no contaba). En LatAm los hospitales y los
 * servicios de salud del Estado rara vez usan dominio `.gob`. Sólo quita LinkedIn:
 * el tamaño se sigue exigiendo, así que un hospital privado pequeño no pasa.
 */
const PUBLIC_HEALTH_BY_NAME = /\b(hospital|servicio de salud|servicios de salud|cesfam|centro de salud familiar|red de salud|ministerio de salud|secretaria de salud|caja de salud|caja nacional de salud|essalud|seguro social)\b/;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDomain(domain: string): string {
  return normalize(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
}

const REQUIRED: LinkedinRequirement = { required: true, reason: null };

export function resolveLinkedinRequirement(input: {
  domain: string | null | undefined;
  name: string | null | undefined;
}): LinkedinRequirement {
  const domain = input.domain ? normalizeDomain(input.domain) : '';
  const name = input.name ? normalize(input.name) : '';

  if (domain && PUBLIC_OR_EDUCATION_DOMAIN.test(domain)) {
    return { required: false, reason: 'public_or_education_domain' };
  }
  if (name && PUBLIC_HEALTH_BY_NAME.test(name)) {
    return { required: false, reason: 'public_health_by_name' };
  }
  if (name && UNAMBIGUOUS_NGO_OR_GUILD.test(name)) {
    return { required: false, reason: 'ngo_or_guild' };
  }
  if (name && domain && ORG_DOMAIN.test(domain) && AMBIGUOUS_NGO_OR_GUILD.test(name)) {
    return { required: false, reason: 'ngo_or_guild' };
  }
  return REQUIRED;
}

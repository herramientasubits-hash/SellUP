// Agente 2A — Contactos SIN correo hacia HubSpot (dueña 25-11). Núcleo PURO: sin red ni DB.
//
// HubSpot no exige correo para crear un contacto (basta nombre o apellido), pero el correo es
// lo ÚNICO con lo que HubSpot reconoce sola a una persona repetida. Sin correo, cada alta es un
// contacto nuevo: si la persona ya estaba, queda duplicada en el CRM del cliente. Por eso, antes
// de crear, SellUp la busca:
//
//   1. por su LinkedIn (el mismo perfil ⇒ la misma persona);
//   2. si no, por su nombre ENTRE LOS CONTACTOS DE SU EMPRESA en HubSpot.
//
// Una sola persona con ese nombre ⇒ se vincula (como hoy con el correo). Varias ⇒ NO se crea
// (sería adivinar cuál es) y queda para que alguien lo resuelva. Ninguna ⇒ se crea.
//
// Sólo se permite con LinkedIn: sin correo NI LinkedIn no hay con qué identificar a la persona
// después, y el contacto sigue bloqueado como antes.

/** Un contacto de HubSpot que puede ser la misma persona (de la empresa o por su LinkedIn). */
export interface HubSpotIdentityCandidate {
  id: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  linkedinUrl: string | null;
}

export interface NoEmailIdentity {
  firstname: string | null;
  lastname: string | null;
  linkedinUrl: string | null;
}

export type NoEmailIdentityDecision =
  | { kind: 'match'; id: string; by: 'linkedin' | 'name' }
  | { kind: 'ambiguous'; count: number }
  | { kind: 'none' };

/**
 * El perfil de LinkedIn de una persona, comparable: `linkedin.com/in/<slug>` en minúsculas y sin
 * codificar («herrerani%C3%B1o» = «herrerañiño»). `null` si no es un perfil personal.
 */
export function linkedinProfileKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = /linkedin\.com\/in\/([^/?#\s]+)/i.exec(value.trim());
  if (!match) return null;
  let slug = match[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Un `%` suelto: se compara tal cual.
  }
  slug = slug.toLowerCase().replace(/\/+$/, '');
  return slug.length > 0 ? slug : null;
}

function foldName(first: string | null, last: string | null): string | null {
  const full = [first, last]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return full.length > 0 ? full : null;
}

/** ¿Hay con qué identificar a la persona sin correo? Sólo con un perfil de LinkedIn válido. */
export function canSyncWithoutEmail(identity: NoEmailIdentity): boolean {
  return linkedinProfileKey(identity.linkedinUrl) !== null;
}

/**
 * Decide si la persona ya está en HubSpot. El LinkedIn manda: el mismo perfil es la misma
 * persona; un perfil DISTINTO es otra persona aunque se llame igual. Por nombre, sólo cuenta
 * quien no tiene otro LinkedIn, y sólo si es UNA.
 */
export function decideHubSpotContactWithoutEmail(
  candidates: readonly HubSpotIdentityCandidate[],
  identity: NoEmailIdentity,
): NoEmailIdentityDecision {
  const key = linkedinProfileKey(identity.linkedinUrl);
  const unique = [...new Map(candidates.map((c) => [c.id, c])).values()];

  if (key) {
    const sameProfile = unique.find((c) => linkedinProfileKey(c.linkedinUrl) === key);
    if (sameProfile) return { kind: 'match', id: sameProfile.id, by: 'linkedin' };
  }

  const name = foldName(identity.firstname, identity.lastname);
  if (!name) return { kind: 'none' };
  const sameName = unique.filter((c) => {
    if (foldName(c.firstname, c.lastname) !== name) return false;
    const otherKey = linkedinProfileKey(c.linkedinUrl);
    return !(key && otherKey && otherKey !== key);
  });
  if (sameName.length === 1) return { kind: 'match', id: sameName[0].id, by: 'name' };
  if (sameName.length > 1) return { kind: 'ambiguous', count: sameName.length };
  return { kind: 'none' };
}

/**
 * Las formas en que HubSpot puede tener guardado el mismo perfil (para buscarlo por igualdad):
 * con y sin `www.`, con y sin barra final. Máximo 5 (los grupos de filtros de HubSpot).
 */
export function linkedinUrlVariants(value: string | null | undefined): string[] {
  const key = linkedinProfileKey(value);
  if (!key) return [];
  const slug = encodeURIComponent(key);
  const variants = [
    `https://www.linkedin.com/in/${slug}`,
    `https://www.linkedin.com/in/${slug}/`,
    `https://linkedin.com/in/${slug}`,
    `https://linkedin.com/in/${slug}/`,
    `linkedin.com/in/${slug}`,
  ];
  return [...new Set(variants)].slice(0, 5);
}

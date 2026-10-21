/**
 * AGENT1-SUPPLIER-WEB-BY-NAME-1 — la web de un proveedor de compras públicas por su NOMBRE
 * cuando el número fiscal no la da (auditoría 21-10, bloque «Próximo»). Puro.
 *
 * Por número fiscal ya no hay más webs que encontrar: medido en Prod 21-10 sobre los
 * proveedores con 3 o más entidades, las demás fuentes del país, el banco y las cuentas no
 * sumaban ni una. Pero los directorios del país (el curado de México tiene 1.011 webs) no
 * traen número fiscal. Por nombre exacto, sin la forma societaria, aparecían: Ecuador +63,
 * Panamá +26, Costa Rica +20, México +16, Chile +7. Cada una que entra aquí no pasa por el
 * rescate de Claude (que cuesta y tiene 60 s).
 *
 * Reglas para no equivocarse de empresa:
 *  - Nombre normalizado IDÉNTICO (mayúsculas, sin tildes ni puntuación, sin «S.A.», «SA DE
 *    CV», «CIA. LTDA.», «SAC»…, ni artículos). Nada de parecidos.
 *  - Al menos 6 letras después de normalizar («ABC SA» no sirve).
 *  - Una sola web para ese nombre en el país: si dos fichas con el mismo nombre dan webs
 *    distintas, ninguna.
 */

/** Formas societarias y palabras vacías que no distinguen a una empresa de otra. */
const NOISE_WORDS = new Set([
  'SA', 'SAS', 'SAC', 'SAA', 'SAB', 'SL', 'SLU', 'SRL', 'SPA', 'LTDA', 'LIMITADA', 'EIRL', 'CV',
  'RL', 'CIA', 'COMPANIA', 'SOCIEDAD', 'ANONIMA', 'CERRADA', 'ABIERTA', 'RESPONSABILIDAD',
  'Y', 'E', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS',
]);

/** Siglas societarias escritas con puntos o espacios («S. A.», «S.A.C.», «S. de R.L.»). */
const SPACED_ABBREVIATIONS: ReadonlyArray<[RegExp, string]> = [
  // «S. de R.L.» (México): antes que «R L», o queda una «S» suelta.
  [/\bS DE R ?L\b/g, 'SRL'],
  [/\bS A S\b/g, 'SAS'],
  [/\bS A C\b/g, 'SAC'],
  [/\bS A A\b/g, 'SAA'],
  [/\bS A B\b/g, 'SAB'],
  [/\bS A\b/g, 'SA'],
  [/\bS R L\b/g, 'SRL'],
  [/\bS L U\b/g, 'SLU'],
  [/\bS L\b/g, 'SL'],
  [/\bS P A\b/g, 'SPA'],
  [/\bE I R L\b/g, 'EIRL'],
  [/\bC V\b/g, 'CV'],
  [/\bR L\b/g, 'RL'],
];

/** Mínimo de letras del nombre normalizado para usarlo como llave. */
export const WEBSITE_NAME_KEY_MIN_CHARS = 6;

/** «Cable & Wireless Panamá, S. A.» → «CABLE WIRELESS PANAMA». `null` si queda muy corto. */
export function companyNameKey(raw: string | null | undefined): string | null {
  let text = (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [pattern, joined] of SPACED_ABBREVIATIONS) text = text.replace(pattern, joined);
  const key = text
    .split(' ')
    .filter((word) => word && !NOISE_WORDS.has(word))
    .join(' ');
  return key.replace(/ /g, '').length >= WEBSITE_NAME_KEY_MIN_CHARS ? key : null;
}

/** Una ficha del país con web (nombre legal y su host ya normalizado). */
export type NamedWebsite = { legalName: string | null; host: string };

/** Nombre → web, sólo cuando ese nombre apunta a UNA web. */
export function indexWebsitesByName(rows: readonly NamedWebsite[]): Map<string, string> {
  const hosts = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = companyNameKey(row.legalName);
    if (!key || !row.host) continue;
    const set = hosts.get(key) ?? new Set<string>();
    set.add(row.host);
    hosts.set(key, set);
  }
  const index = new Map<string, string>();
  for (const [key, set] of hosts) if (set.size === 1) index.set(key, [...set][0]);
  return index;
}

/** Número fiscal → web, para los proveedores cuyo nombre está en el índice. */
export function matchWebsitesByName(
  companies: ReadonlyArray<{ taxId: string; name: string }>,
  index: ReadonlyMap<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const company of companies) {
    const key = companyNameKey(company.name);
    const host = key ? index.get(key) : undefined;
    if (host) out.set(company.taxId, host);
  }
  return out;
}

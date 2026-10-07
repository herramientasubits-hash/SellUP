/**
 * cr-official-lists.ts — lectura de listas oficiales de Costa Rica que se publican
 * en PDF (SUGEF «Entidades supervisadas», Hacienda «Grandes Contribuyentes
 * Nacionales») y cruce con las fichas de MIDEPLAN («Organización del Sector
 * Público Costarricense»: sigla y sitio web de cada institución).
 *
 * SOURCES-CR-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj. El texto llega ya
 * extraído del PDF (`pdftotext -layout`).
 */

import { costaRicaNameCore, costaRicaPublicEntityKey } from './cr-name-keys';
import { normalizeCostaRicaCompanyCedula, type CrNamedCedula } from './cr-company-registry-rows';

/** Cédula jurídica escrita con guiones o sin ellos («3-101-012009», «4000042139»). */
const CEDULA_IN_TEXT = /\b([234])-?(\d{3})-?(\d{6})\b/;

/** Numeración de una entrada de lista («10. Banco …»). */
const NUMBERED_ENTRY = /^\s*\d{1,3}\.\s+/;

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Pares cédula → nombre de una lista en texto. La cédula puede ir en la misma
 * línea que el nombre (antes o después) o en la línea siguiente; un nombre que
 * ocupa varias líneas («Davibank (Costa Rica) S.A. (antes / Scotiabank de Costa
 * Rica S.A.)») se junta hasta su número de entrada.
 */
export function parseCrNamedCedulaListText(text: string): CrNamedCedula[] {
  const lines = text.split(/\r?\n/);
  const out: CrNamedCedula[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const match = CEDULA_IN_TEXT.exec(lines[i]);
    if (match === null) continue;
    const cedula = normalizeCostaRicaCompanyCedula(`${match[1]}${match[2]}${match[3]}`);
    if (cedula === null || seen.has(cedula)) continue;
    // Nombre en la misma línea, sin la cédula ni códigos numéricos sueltos.
    let name = clean(lines[i].replace(match[0], ' ').replace(/\b\d{6,}\b/g, ' ').replace(NUMBERED_ENTRY, ''));
    if (costaRicaNameCore(name).length < 2) {
      // Nombre en las líneas de arriba, hasta la que lleva el número de entrada.
      const parts: string[] = [];
      for (let j = i - 1; j >= 0 && j >= i - 4; j -= 1) {
        const line = lines[j].trim();
        if (line.length === 0 || CEDULA_IN_TEXT.test(line)) break;
        parts.unshift(line);
        if (NUMBERED_ENTRY.test(line)) break;
      }
      name = clean(parts.join(' ').replace(NUMBERED_ENTRY, ''));
    }
    if (costaRicaNameCore(name).length < 2) continue;
    seen.add(cedula);
    out.push({ cedula, name });
  }
  return out;
}

/** Una ficha de MIDEPLAN ya leída. */
export type CrMideplanInstitution = { name: string | null; web: string | null };

/** «Instituto Costarricense de Electricidad (ICE)» → { name, acronym: 'ICE' }. */
export function splitCrInstitutionAcronym(raw: string): { name: string; acronym: string | null } {
  const match = /^(.*\S)\s*\(([A-Za-zÁÉÍÓÚÑáéíóúñ0-9\- ]{2,15})\)\s*$/.exec(raw.trim());
  if (match === null) return { name: raw.trim(), acronym: null };
  const acronym = match[2].replace(/\s+/g, '');
  // Una sigla tiene al menos dos mayúsculas («ICE», «Prodhab» → PRODHAB sí; «S.A.» no).
  if (!/[A-Z].*[A-Z]/.test(acronym) && !/^[A-Z][a-z]+$/.test(acronym)) return { name: raw.trim(), acronym: null };
  if (/^(SA|SRL|S\.A\.)$/i.test(acronym)) return { name: raw.trim(), acronym: null };
  return { name: match[1].trim(), acronym: acronym.toUpperCase() };
}

/** Claves para cruzar por nombre (núcleo y, si aplica, clave de municipalidad). */
function crossKeys(name: string): string[] {
  const core = costaRicaNameCore(name);
  const keys = core.length >= 2 ? [core] : [];
  const publicKey = costaRicaPublicEntityKey(core);
  if (publicKey !== null) keys.push(publicKey);
  return keys;
}

/**
 * Cruza las fichas de MIDEPLAN con las instituciones que tienen cédula (SICOP)
 * por nombre exacto (núcleo): la sigla oficial y la web de cada cédula. Una ficha
 * que coincide con dos cédulas no se usa.
 */
export function matchCrMideplanInstitutions(
  institutions: readonly CrNamedCedula[],
  fichas: readonly CrMideplanInstitution[],
): Map<string, { acronym: string | null; web: string | null }> {
  const cedulasByKey = new Map<string, Set<string>>();
  for (const inst of institutions) {
    const cedula = normalizeCostaRicaCompanyCedula(inst.cedula);
    if (cedula === null || typeof inst.name !== 'string') continue;
    for (const key of crossKeys(inst.name)) cedulasByKey.set(key, (cedulasByKey.get(key) ?? new Set()).add(cedula));
  }
  const out = new Map<string, { acronym: string | null; web: string | null }>();
  for (const ficha of fichas) {
    if (typeof ficha.name !== 'string' || ficha.name.trim().length === 0) continue;
    const { name, acronym } = splitCrInstitutionAcronym(ficha.name);
    const hits = new Set<string>();
    for (const key of crossKeys(name)) for (const cedula of cedulasByKey.get(key) ?? []) hits.add(cedula);
    if (hits.size !== 1) continue;
    const [cedula] = [...hits];
    if (!out.has(cedula)) out.set(cedula, { acronym, web: ficha.web?.trim() || null });
  }
  return out;
}

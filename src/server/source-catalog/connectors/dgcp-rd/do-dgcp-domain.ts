/**
 * do-dgcp-domain.ts — dominio web de una empresa dominicana a partir de los
 * correos que publica como proveedora del Estado (DGCP).
 *
 * SOURCES-DO-DGCP-DOMAIN-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué ─────────────────────────────────────────────────────────────────
 *
 * El padrón DGII no publica sitio web, así que toda empresa del buscador
 * gratuito de República Dominicana llegaba sin dominio y, por la regla #525,
 * iba a «Descartadas». El rescate con Claude (06-10, lote RD×Tec 8c1dcf78)
 * encontró el sitio correcto de muchas, pero no pudo comprobarlo: 0 de 38.
 * Decisión de la dueña (06-10): sacar el dominio del correo comercial de la DGCP.
 *
 * ── La regla, conservadora a propósito ──────────────────────────────────────
 *
 * Los correos del registro de proveedores traen mucho ruido: correo gratuito
 * (gmail, hotmail), de proveedores de internet (claro.net.do), mal escritos
 * («gmial») y dominios de despachos que constituyen empresas o llevan su
 * contabilidad (company24h.com, expresscompaniesdr.com). Por eso un dominio sólo
 * se acepta si su nombre se PARECE a la razón social:
 *   · es la razón social sin forma societaria, entera o sin palabras genéricas
 *     («sinergit.com.do», «multicomputos.com», «mattarconsulting.com»);
 *   · son sus iniciales («dca.com.do» para Dionisio Constanzo & Asociados);
 *   · empieza por la primera palabra distintiva («equifax.com»); o
 *   · es el comienzo de la razón social («golddata.net»).
 * Manda el correo comercial; luego el de contacto; luego el de notificaciones.
 * Si dos dominios distintos pasan en el mismo nivel, ninguno. Una marca distinta
 * de la razón social («claro.com.do» para Compañía Dominicana de Teléfonos) NO
 * se acepta: preferimos perder dominios a poner el de otra empresa.
 *
 * Sólo se guarda el DOMINIO: nunca el correo, ni el contacto, ni el teléfono.
 */

/** Correo gratuito, de proveedores de internet o con errores de escritura. */
const NON_CORPORATE_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'gmial.com', 'gmai.com', 'gamil.com', 'gmail.es', 'googlemail.com',
  'hotmail.com', 'hotmail.es', 'hotmail.com.do', 'homail.com', 'hotmai.com', 'hotmal.com',
  'outlook.com', 'outlook.es', 'oulook.com', 'live.com', 'live.com.do', 'msn.com',
  'yahoo.com', 'yahoo.es', 'yahoo.com.mx', 'ymail.com', 'aol.com',
  'icloud.com', 'me.com', 'mail.com', 'protonmail.com', 'proton.me', 'zoho.com',
  'claro.net.do', 'codetel.net.do', 'verizon.net.do', 'tricom.net', 'tricom.net.do',
  'orange.net.do', 'wind.net.do', 'altice.net.do',
]);

/** Etiquetas que nunca son el nombre de una empresa. */
const GENERIC_LABELS: ReadonlySet<string> = new Set([
  'PROVEEDORES', 'PROVEEDORE', 'MAIL', 'CORREO', 'EMAIL', 'INFO', 'EMPRESA', 'EMPRESAS',
  'MAILC24H', 'COMPANY24H',
]);

/** Formas societarias dominicanas (ya sin puntuación), al final del nombre. */
const LEGAL_FORM_TOKENS: ReadonlySet<string> = new Set([
  'S', 'A', 'SA', 'SRL', 'R', 'L', 'SAS', 'EIRL', 'E', 'I', 'C', 'POR', 'CXA', 'INC', 'CORP', 'LTD', 'LLC', 'SL',
]);

/** Palabras que no distinguen a una empresa de otra. */
const GENERIC_NAME_TOKENS: ReadonlySet<string> = new Set([
  'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'EN', 'POR', 'PARA', 'THE', 'OF', 'AND',
  'DOMINICANA', 'DOMINICANO', 'REPUBLICA', 'DOMINICAN', 'REPUBLIC', 'RD',
  'GRUPO', 'GROUP', 'COMPANIA', 'CIA', 'CORPORACION', 'CORPORATION', 'EMPRESA', 'EMPRESAS',
  'SERVICIOS', 'SERVICES', 'SOLUCIONES', 'SOLUTIONS', 'INTERNACIONAL', 'INTERNATIONAL',
]);

/** Segundo nivel genérico bajo un dominio de país («com.do», «gob.do»…). */
const SECOND_LEVEL: ReadonlySet<string> = new Set(['com', 'gob', 'gov', 'net', 'org', 'edu', 'co']);

const MIN_LABEL_LENGTH = 3;
/** La primera palabra distintiva sirve de prefijo sólo si tiene al menos 4 letras. */
const MIN_PREFIX_TOKEN = 4;
/** Un dominio que es el comienzo de la razón social debe tener al menos 5 letras. */
const MIN_NAME_PREFIX = 5;

const EMAIL_DOMAIN = /@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,})/gi;

function nameTokens(name: string): string[] {
  const tokens = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  while (tokens.length > 0 && LEGAL_FORM_TOKENS.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens;
}

/** Dominios de una cadena de correos, en orden y sin repetir, ya sin «www.». */
export function emailDomains(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const match of (text ?? '').matchAll(EMAIL_DOMAIN)) {
    const domain = match[1].toLowerCase().replace(/^www\./, '');
    if (!out.includes(domain)) out.push(domain);
  }
  return out;
}

/** La etiqueta que identifica al dueño: «sinergit» de sinergit.com.do, «equifax» de equifax.com. */
export function registrableLabel(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  if (parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2])) {
    return parts[parts.length - 3];
  }
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? '');
}

/** ¿El nombre del dominio se parece a la razón social? (reglas en la cabecera). */
export function domainMatchesCompanyName(domain: string, legalName: string): boolean {
  const label = registrableLabel(domain).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (label.length < MIN_LABEL_LENGTH || GENERIC_LABELS.has(label)) return false;

  const tokens = nameTokens(legalName);
  if (tokens.length === 0) return false;
  const distinctive = tokens.filter((t) => !GENERIC_NAME_TOKENS.has(t));
  const core = distinctive.length > 0 ? distinctive : tokens;
  const full = tokens.join('');
  const coreJoined = core.join('');

  if (label === full || label === coreJoined) return true;
  if (core.length >= 2 && label === core.map((t) => t[0]).join('')) return true;
  if (core[0].length >= MIN_PREFIX_TOKEN && label.startsWith(core[0])) return true;
  if (label.length >= MIN_NAME_PREFIX && (full.startsWith(label) || coreJoined.startsWith(label))) return true;
  return false;
}

export type DgcpProviderEmails = {
  legalName: string;
  commercial?: string | null;
  contact?: string | null;
  notifications?: string | null;
};

/**
 * El dominio corporativo de una proveedora, o `null`. Recorre los correos por
 * prioridad; en el primer nivel con algún dominio aceptable decide: uno solo ⇒
 * ése; varios distintos ⇒ ninguno.
 */
export function corporateDomainFromDgcpEmails(input: DgcpProviderEmails): string | null {
  for (const field of [input.commercial, input.contact, input.notifications]) {
    const accepted = emailDomains(field).filter(
      (domain) => !NON_CORPORATE_DOMAINS.has(domain) && domainMatchesCompanyName(domain, input.legalName),
    );
    const labels = new Set(accepted.map(registrableLabel));
    if (labels.size === 1) return accepted[0];
    if (labels.size > 1) return null;
  }
  return null;
}

const BUSINESS_RNC = /^\d{9}$/;

/**
 * RNC → dominio a partir de las filas del archivo de proveedores de la DGCP
 * (`Proveedores.csv` de datosabiertos.dgcp.gob.do). Sólo RNC de empresa. Si un
 * RNC aparece dos veces con dominios distintos, se queda sin dominio.
 */
export function buildDgcpDomainMap(rows: Iterable<Record<string, string>>): Map<string, string> {
  const out = new Map<string, string>();
  const conflicted = new Set<string>();
  for (const row of rows) {
    if ((row['TIPO_DOCUMENTO'] ?? '').trim().toUpperCase() !== 'RNC') continue;
    const rnc = (row['NUMERO_DOCUMENTO'] ?? '').replace(/\D/g, '');
    if (!BUSINESS_RNC.test(rnc) || conflicted.has(rnc)) continue;
    const domain = corporateDomainFromDgcpEmails({
      legalName: row['RAZON_SOCIAL'] ?? '',
      commercial: row['CORREO_COMERCIAL'],
      contact: row['CORREO_CONTACTO'],
      notifications: row['CORREO_NOTIFICACIONES'],
    });
    if (domain === null) continue;
    const previous = out.get(rnc);
    if (previous !== undefined && previous !== domain) {
      out.delete(rnc);
      conflicted.add(rnc);
      continue;
    }
    out.set(rnc, domain);
  }
  return out;
}

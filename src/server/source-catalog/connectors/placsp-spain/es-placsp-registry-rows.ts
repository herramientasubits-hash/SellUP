/**
 * es-placsp-registry-rows.ts — sociedades adjudicatarias de contratos públicos en
 * España (Plataforma de Contratación del Sector Público, PLACSP), para el NIF por
 * nombre dentro de la corrida del Agente 1.
 *
 * SOURCES-ES-NIF-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * España no publica el NIF de las empresas en ningún registro abierto. La única
 * fuente oficial y gratuita que lo trae es la sindicación de la PLACSP (ATOM,
 * CODICE): cada adjudicación nombra a su ganadora así:
 *
 *   <cac:WinningParty>
 *     <cac:PartyIdentification><cbc:ID schemeName="NIF">B10383917</cbc:ID></cac:PartyIdentification>
 *     <cac:PartyName><cbc:Name>GLOBALEX GESTION&amp;SERVICIOS S.L</cbc:Name></cac:PartyName>
 *   </cac:WinningParty>
 *
 * Sólo entran NIF de SOCIEDADES (letra inicial de persona jurídica, control
 * válido): nunca DNI/NIE de personas físicas ni identificadores «OTROS»/«UTE».
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { normalizeCompanyNameCore, SPAIN_LEGAL_FORMS } from '../../company-name-core';
import { calculateSpainCompanyNifControl } from '@/modules/prospect-batches/tax-identifier-rules';

export const ES_PLACSP_REGISTRY_SOURCE_KEY = 'es_placsp_registry' as const;
export const ES_COUNTRY_CODE = 'ES' as const;

const COMPANY_NIF = /^[A-HJNPQRSUVW]\d{7}[0-9A-J]$/;

const WINNING_PARTY =
  /<cac:WinningParty>\s*<cac:PartyIdentification>\s*<cbc:ID schemeName="([^"]*)">([^<]*)<\/cbc:ID>\s*<\/cac:PartyIdentification>\s*<cac:PartyName>\s*<cbc:Name>([^<]*)<\/cbc:Name>/g;

export type EsPlacspRegistryRow = {
  source_key: typeof ES_PLACSP_REGISTRY_SOURCE_KEY;
  country_code: typeof ES_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Núcleo del nombre español: el MISMO que calcula el resolvedor de la corrida. */
export function normalizeSpainCompanyCore(name: string | null | undefined): string {
  return normalizeCompanyNameCore(name, SPAIN_LEGAL_FORMS);
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/** NIF crudo → NIF de sociedad normalizado, o `null`. */
export function normalizeSpainCompanyNif(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const nif = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!COMPANY_NIF.test(nif)) return null;
  const control = calculateSpainCompanyNifControl(nif.slice(1, 8));
  if (control === null || (nif[8] !== control.digit && nif[8] !== control.letter)) return null;
  return nif;
}

/** Adjudicatarias (NIF de sociedad + nombre) de un trozo de XML de la PLACSP. */
export function extractPlacspWinners(xml: string): Array<{ nif: string; name: string }> {
  const winners: Array<{ nif: string; name: string }> = [];
  for (const match of xml.matchAll(WINNING_PARTY)) {
    if (match[1] !== 'NIF') continue;
    const nif = normalizeSpainCompanyNif(match[2]);
    const name = decodeXmlText(match[3]).replace(/\s+/g, ' ').trim();
    if (nif !== null && name.length > 0) winners.push({ nif, name });
  }
  return winners;
}

/** Adjudicataria → fila mínima, o `null` si su nombre no tiene núcleo útil. */
export function buildEsPlacspRegistryRow(
  winner: { nif: string; name: string },
  params: { sourceYear: number; importedAt: string },
): EsPlacspRegistryRow | null {
  const core = normalizeSpainCompanyCore(winner.name);
  if (core.length < 2) return null;
  const identity = deriveTaxRecordIdentity(winner.nif);
  return {
    source_key: ES_PLACSP_REGISTRY_SOURCE_KEY,
    country_code: ES_COUNTRY_CODE,
    source_year: params.sourceYear,
    tax_id: winner.nif,
    normalized_tax_id: winner.nif,
    legal_name: winner.name,
    normalized_legal_name: core,
    raw_data: {},
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

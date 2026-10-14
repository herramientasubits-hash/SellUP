/**
 * br-receita-input.ts — lectura de las dos entradas de la carga liviana de Brasil:
 * una línea del TSV de `scripts/source-catalog/extract-br-receita-light.py` y el
 * cadastro de compañías abiertas de la CVM (`cad_cia_aberta.csv`).
 *
 * SOURCES-BR-LIGHT-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import { normalizeBrazilCnpj } from '../br-receita-cnpj/br-cnpj';
import type { BrCvmListing, BrReceitaCompanyRecord } from './br-receita-rows';

/** Columnas del TSV, en orden (las escribe `extract-br-receita-light.py`). */
export const BR_RECEITA_LIGHT_COLUMNS = [
  'cnpj', 'razao_social', 'nome_fantasia', 'natureza', 'capital', 'porte', 'data_inicio', 'cnae',
  'cnae_descricao', 'uf', 'municipio', 'email_domain', 'filiais_ativas', 'pais',
] as const;

const blank = (value: string | undefined): string | null => {
  const text = value?.trim() ?? '';
  return text.length > 0 ? text : null;
};

/** Una línea del TSV → registro, o `null` si no tiene la forma esperada. */
export function parseBrReceitaLightLine(line: string): BrReceitaCompanyRecord | null {
  const cells = line.replace(/\r?\n$/, '').split('\t');
  if (cells.length < BR_RECEITA_LIGHT_COLUMNS.length) return null;
  const [cnpj, legalName, tradeName, natureza, capital, porte, openingDate, cnae, cnaeDescription, uf, municipality, emailDomain, branches, country] =
    cells;
  if (cnpj === 'cnpj' || !legalName?.trim()) return null;
  const capitalValue = Number(capital);
  const branchesValue = Number(branches);
  return {
    cnpj: cnpj.trim(),
    legalName: legalName.trim(),
    tradeName: blank(tradeName),
    naturezaJuridica: natureza.trim(),
    capitalSocial: Number.isFinite(capitalValue) ? capitalValue : 0,
    porte: porte.trim(),
    openingDate: blank(openingDate),
    cnae: blank(cnae),
    cnaeDescription: blank(cnaeDescription),
    uf: blank(uf),
    municipality: blank(municipality),
    emailDomain: blank(emailDomain),
    activeBranches: Number.isInteger(branchesValue) && branchesValue > 0 ? branchesValue : 0,
    countryCode: blank(country),
  };
}

/**
 * Cadastro de la CVM (separado por «;», primera línea = cabecera) → compañías
 * ACTIVAS por CNPJ. Del correo sólo se guarda el dominio.
 */
export function parseCvmCadastro(text: string): Map<string, BrCvmListing> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const listings = new Map<string, BrCvmListing>();
  if (lines.length === 0) return listings;
  const header = lines[0].split(';');
  const col = (name: string): number => header.indexOf(name);
  const [iCnpj, iTrade, iStatus, iEmail, iSector] = ['CNPJ_CIA', 'DENOM_COMERC', 'SIT', 'EMAIL', 'SETOR_ATIV'].map(col);
  if ([iCnpj, iTrade, iStatus, iEmail].some((i) => i < 0)) return listings;
  for (const line of lines.slice(1)) {
    const cells = line.split(';');
    if (cells[iStatus]?.trim().toUpperCase() !== 'ATIVO') continue;
    const cnpj = normalizeBrazilCnpj(cells[iCnpj] ?? '');
    if (cnpj.status !== 'valid' || cnpj.normalized === null) continue;
    const email = cells[iEmail]?.trim().toLowerCase() ?? '';
    const domain = email.includes('@') ? email.split('@')[1]?.trim() || null : null;
    listings.set(cnpj.normalized, {
      tradeName: blank(cells[iTrade]),
      domain,
      sector: iSector >= 0 ? blank(cells[iSector]) : null,
    });
  }
  return listings;
}

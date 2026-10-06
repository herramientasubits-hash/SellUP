/**
 * mx-rfc-public-lists-rows.ts — RFC de personas morales de listas oficiales
 * públicas de México, para el RFC por nombre dentro de la corrida del Agente 1.
 *
 * SOURCES-MX-RFC-PUBLIC-LISTS-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * CompraNet sólo cubre a quien le vendió al Gobierno federal (26.393 empresas).
 * Estas listas suman ~82.000 RFC más, publicadas por transparencia:
 *   · SAT, Padrón de Importadores (+ sectoriales de importación y exportación):
 *     empresas privadas medianas y grandes.
 *   · SAT, Directorio de Donatarias Autorizadas (sólo activas): universidades
 *     privadas, colegios, ONG — donde CompraNet casi nunca encuentra el RFC.
 *   · Nuevo León, padrón de proveedores: trae la estratificación (tamaño).
 * Medido con 177 nombres reales de México que llegaron a SellUp: CompraNet sola
 * da 11 RFC seguros; con estas listas, 26.
 *
 * Sólo RFC de PERSONA MORAL (12 caracteres). Ni teléfonos, ni correos, ni
 * domicilios, ni representantes: sólo RFC, razón social y de qué lista sale.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import {
  MX_COUNTRY_CODE,
  normalizeMexicoCompanyCore,
  normalizeMexicoMoralRfc,
} from '../compranet-mexico/mx-compranet-rfc-rows';

export const MX_RFC_PUBLIC_LISTS_SOURCE_KEY = 'mx_rfc_public_lists_registry' as const;

/**
 * Listas aceptadas, en orden de preferencia para el nombre: cuando un RFC sale en
 * varias, gana el nombre de la primera (las de donatarias y Nuevo León vienen
 * escritas con más cuidado que el PDF de importadores).
 */
export const MX_RFC_PUBLIC_LISTS = [
  'sat_donatarias',
  'nl_proveedores',
  'sat_importadores_sectorial',
  'sat_exportadores_sectorial',
  'sat_importadores',
] as const;

export type MxRfcPublicList = (typeof MX_RFC_PUBLIC_LISTS)[number];

export type MxRfcPublicListEntry = {
  rfc: string | null;
  name: string | null;
  list: string;
  /** Donatarias: tipo (letra del SAT). Nuevo León: estratificación. Resto: vacío. */
  extra: string | null;
};

export type MxRfcPublicListsRow = {
  source_key: typeof MX_RFC_PUBLIC_LISTS_SOURCE_KEY;
  country_code: typeof MX_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: {
    lists: MxRfcPublicList[];
    donataria_type?: string;
    stratification?: string;
  };
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

const LIST_RANK = new Map<string, number>(MX_RFC_PUBLIC_LISTS.map((list, index) => [list, index]));
const DONATARIA_TYPE = /^[A-Z]$/;
const STRATIFICATIONS = new Set(['MICRO', 'PEQUEÑA', 'MEDIANA', 'GRANDE']);

function isKnownList(list: string): list is MxRfcPublicList {
  return LIST_RANK.has(list);
}

/** Entradas de las listas → una fila por RFC de persona moral. */
export function buildMxRfcPublicListsRows(
  entries: Iterable<MxRfcPublicListEntry>,
  params: { importedAt: string; sourceYear: number },
): MxRfcPublicListsRow[] {
  const byRfc = new Map<string, { name: string; rank: number; lists: Set<MxRfcPublicList>; donataria?: string; size?: string }>();

  for (const entry of entries) {
    const rfc = normalizeMexicoMoralRfc(entry.rfc);
    const name = (entry.name ?? '').replace(/\s+/g, ' ').trim();
    if (rfc === null || name.length === 0 || !isKnownList(entry.list)) continue;
    const rank = LIST_RANK.get(entry.list)!;
    const extra = (entry.extra ?? '').trim().toUpperCase();

    const current = byRfc.get(rfc) ?? { name, rank, lists: new Set<MxRfcPublicList>() };
    if (rank < current.rank) {
      current.name = name;
      current.rank = rank;
    }
    current.lists.add(entry.list);
    if (entry.list === 'sat_donatarias' && DONATARIA_TYPE.test(extra)) current.donataria = extra;
    if (entry.list === 'nl_proveedores' && STRATIFICATIONS.has(extra)) current.size = extra;
    byRfc.set(rfc, current);
  }

  const rows: MxRfcPublicListsRow[] = [];
  for (const [rfc, item] of byRfc) {
    const core = normalizeMexicoCompanyCore(item.name);
    if (core.length < 2) continue;
    const identity = deriveTaxRecordIdentity(rfc);
    rows.push({
      source_key: MX_RFC_PUBLIC_LISTS_SOURCE_KEY,
      country_code: MX_COUNTRY_CODE,
      source_year: params.sourceYear,
      tax_id: rfc,
      normalized_tax_id: rfc,
      legal_name: item.name,
      normalized_legal_name: core,
      raw_data: {
        lists: [...item.lists].sort((a, b) => LIST_RANK.get(a)! - LIST_RANK.get(b)!),
        ...(item.donataria ? { donataria_type: item.donataria } : {}),
        ...(item.size ? { stratification: item.size } : {}),
      },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows.sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
}

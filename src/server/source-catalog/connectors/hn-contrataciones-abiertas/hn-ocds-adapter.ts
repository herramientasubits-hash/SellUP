/**
 * Honduras Contrataciones Abiertas — OCDS Adapter
 *
 * Extrae candidatos técnicos de releases OCDS Honduras.
 * Solo procesa parties con identifier.scheme === 'HN-RTN' y roles supplier/tenderer.
 * Ignora buyers, procuring entities, compradores públicos y X-ONCAE-SUPPLIERS-HC1.
 * Agrega por RTN normalizado (un candidato por proveedor único).
 *
 * NO escribe en DB. NO crea contactos. Hito Centroamérica.8C.1
 */

import { normalizeHondurasRtn } from './hn-rtn-normalizer';
import { HN_SOURCE_KEY } from './hn-ocds-types';
import type { HnOcdsCandidate, OcdsRelease, OcdsParty } from './hn-ocds-types';

const SUPPLIER_ROLES = new Set(['supplier', 'tenderer']);
const IGNORED_SCHEMES = new Set(['X-ONCAE-SUPPLIERS-HC1']);

/** Indicadores léxicos de persona jurídica en el nombre. */
const LEGAL_ENTITY_MARKERS = [
  ' SA',
  ' S.A.',
  ' S.A',
  'S DE RL',
  'S. DE R.L.',
  ' SRL',
  ' S.R.L.',
  'SOCIEDAD',
  'CORPORACIÓN',
  'CORPORACION',
  'GRUPO',
  'EMPRESA',
  'INDUSTRIAS',
  'INDUSTRIA ',
  'COMERCIAL',
  'INVERSIONES',
  'DISTRIBUIDORA',
  'IMPORTADORA',
  'CONSTRUCTORA',
  'SERVICIOS',
  'CONSULTORA',
  'TECNOLOGIA',
  'TECNOLOGÍA',
  'FERRETERIA',
  'FERRETERÍA',
  'FARMACIA',
  'LABORATORIO',
];

function classifyLegalEntity(name: string): {
  hint: HnOcdsCandidate['legalEntityHint'];
  reason: string | null;
} {
  const upper = name.toUpperCase();
  for (const marker of LEGAL_ENTITY_MARKERS) {
    if (upper.includes(marker.toUpperCase())) {
      return { hint: 'likely_legal_entity', reason: marker.trim() };
    }
  }
  return { hint: 'unknown_or_person_natural_risk', reason: null };
}

function toStr(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function toNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function hasSupplierRole(party: OcdsParty): boolean {
  return Array.isArray(party.roles) && party.roles.some((r) => SUPPLIER_ROLES.has(r));
}

/** Estado acumulador por RTN normalizado. */
type Accumulator = {
  name: string;
  rawRtn: string;
  normalizedRtn: string;
  roles: Set<string>;
  ocids: Set<string>;
  awardsCount: number;
  tendersCount: number;
  contractsCount: number;
  totalAwardAmount: number;
  hasAwardAmount: boolean;
  latestDate: string | null;
  rawIdentifierId: string | null;
};

/**
 * Extrae parties relevantes de un release OCDS Honduras.
 * Retorna map de RTN normalizado → acumulador actualizado.
 * Muta el map de entrada para acumulación multi-release.
 */
export function accumulateRelease(
  release: OcdsRelease,
  acc: Map<string, Accumulator>,
): void {
  const ocid = toStr(release.ocid);
  const releaseDate = toStr(release.date);

  const parties = Array.isArray(release.parties) ? release.parties : [];
  const awards = Array.isArray(release.awards) ? release.awards : [];

  // Award total amount for this release (first award with value)
  let releaseAwardAmount: number | null = null;
  let releaseAwardsCount = 0;
  for (const award of awards) {
    const amount = toNum(award.value?.amount);
    if (amount !== null && releaseAwardAmount === null) {
      releaseAwardAmount = amount;
    }
    releaseAwardsCount++;
  }

  for (const party of parties) {
    if (!hasSupplierRole(party)) continue;

    const scheme = toStr(party.identifier?.scheme);
    if (scheme && IGNORED_SCHEMES.has(scheme)) continue;
    if (scheme !== 'HN-RTN') continue;

    const rawId = toStr(party.identifier?.id);
    const rtnResult = normalizeHondurasRtn(rawId);
    if (!rtnResult.isValid) continue;

    const name = toStr(party.name) ?? toStr(party.identifier?.legalName) ?? 'Sin nombre';
    const normalizedRtn = rtnResult.normalized;
    const roles = Array.isArray(party.roles) ? party.roles.filter(Boolean) : [];

    let entry = acc.get(normalizedRtn);
    if (!entry) {
      entry = {
        name,
        rawRtn: rtnResult.raw ?? rawId ?? '',
        normalizedRtn,
        roles: new Set(),
        ocids: new Set(),
        awardsCount: 0,
        tendersCount: 0,
        contractsCount: 0,
        totalAwardAmount: 0,
        hasAwardAmount: false,
        latestDate: null,
        rawIdentifierId: rawId,
      };
      acc.set(normalizedRtn, entry);
    }

    for (const r of roles) entry.roles.add(r);
    if (ocid) entry.ocids.add(ocid);

    if (roles.includes('supplier')) {
      entry.awardsCount += releaseAwardsCount;
      if (releaseAwardAmount !== null) {
        entry.totalAwardAmount += releaseAwardAmount;
        entry.hasAwardAmount = true;
      }
    }
    if (roles.includes('tenderer')) entry.tendersCount++;

    if (releaseDate) {
      if (!entry.latestDate || releaseDate > entry.latestDate) {
        entry.latestDate = releaseDate;
      }
    }
  }
}

/** Convierte el map de acumuladores en candidatos finales. */
export function buildCandidates(acc: Map<string, Accumulator>): HnOcdsCandidate[] {
  const candidates: HnOcdsCandidate[] = [];
  for (const entry of acc.values()) {
    const { hint, reason } = classifyLegalEntity(entry.name);
    candidates.push({
      sourceKey: HN_SOURCE_KEY,
      countryCode: 'HN',
      supplierName: entry.name,
      rawRtn: entry.rawRtn,
      normalizedRtn: entry.normalizedRtn,
      rtnValid: true,
      roles: Array.from(entry.roles),
      ocids: Array.from(entry.ocids),
      awardsCount: entry.awardsCount,
      tendersCount: entry.tendersCount,
      contractsCount: entry.contractsCount,
      totalAwardAmount: entry.hasAwardAmount ? entry.totalAwardAmount : null,
      latestDate: entry.latestDate,
      legalEntityHint: hint,
      legalEntityReason: reason,
      source: 'ocp_registry_jsonl',
      metadata: {
        rawIdentifierId: entry.rawIdentifierId,
      },
    });
  }
  return candidates;
}

/** Stats sobre parties vistas durante el procesamiento. */
export type HnAdapterStats = {
  partiesSeen: number;
  supplierOrTendererSeen: number;
  hnRtnSeen: number;
  validRtn: number;
  invalidRtn: number;
  legacySchemeIgnored: number;
};

/**
 * Procesa un release completo y retorna stats incrementales.
 * Muta el accumulator para acumulación multi-release.
 */
export function processRelease(
  release: OcdsRelease,
  acc: Map<string, Accumulator>,
): HnAdapterStats {
  const stats: HnAdapterStats = {
    partiesSeen: 0,
    supplierOrTendererSeen: 0,
    hnRtnSeen: 0,
    validRtn: 0,
    invalidRtn: 0,
    legacySchemeIgnored: 0,
  };

  const parties = Array.isArray(release.parties) ? release.parties : [];
  stats.partiesSeen = parties.length;

  for (const party of parties) {
    if (!hasSupplierRole(party)) continue;
    stats.supplierOrTendererSeen++;

    const scheme = toStr(party.identifier?.scheme);
    if (scheme && IGNORED_SCHEMES.has(scheme)) {
      stats.legacySchemeIgnored++;
      continue;
    }
    if (scheme !== 'HN-RTN') continue;

    stats.hnRtnSeen++;
    const rawId = toStr(party.identifier?.id);
    const rtnResult = normalizeHondurasRtn(rawId);
    if (rtnResult.isValid) {
      stats.validRtn++;
    } else {
      stats.invalidRtn++;
    }
  }

  accumulateRelease(release, acc);
  return stats;
}

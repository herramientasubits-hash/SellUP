/**
 * SOURCES-EC-CLOSE-1 — the Ecuador name → RUC resolver used inside the Agent 1
 * run, as ONE resolver over several official snapshots tried in order (the
 * second source is only asked when the first gave no strong RUC):
 *
 *   1. `ec_scvs_registry`        — Superintendencia de Compañías, ACTIVE
 *      companies only, with the employees declared in the ranking (the size
 *      travels with a strong match to the ICP size gate, like Chile's SII).
 *   2. `ec_scvs_alias_registry`  — the acronym / short name inside the legal
 *      name («… S.A. CONECEL», «(DIFARE)»).
 *   3. `ec_sri_registry`         — SRI taxpayer registry, active societies NOT
 *      in the Superintendencia: public entities (local governments in canonical
 *      form «GAD MUNICIPAL QUITO»), banks, cooperatives, foundations, schools.
 *   4. `ec_sri_trade_name_registry` — the SRI trade name («SUPERMAXI»): a SIGNAL
 *      only, unless the one company that carries it is large.
 *   5. `ec_scvs`                 — the July snapshot (bi_compania: active AND
 *      inactive, no employees), kept last so Ecuador still resolves before the
 *      new sources are loaded. Its old resolver gave a one-word name a strong RUC
 *      («MOVISTAR S.A.», an inactive company, for Movistar); here a one-word
 *      name is a signal only.
 *
 * A one-word name («Pronaca», «Movistar») is strong only when the ONE company
 * that carries it declared 200+ employees: a small homonym stays a signal.
 *
 * SOURCES-EC-NAME-MATCH-GAPS-1 — Apollo names many companies with the country
 * at the end («Dibeal Ecuador», «Servident Ec»); the registries carry them
 * without it («DIBEAL»). When the full name gives no strong RUC, the chain is
 * asked AGAIN with the name without that ending (never the July `ec_scvs`
 * snapshot, which mixes inactive companies). The retry sees the shorter name as
 * the candidate's own, so a one-word result («DIBEAL») still follows the
 * one-word rule: strong only for a 200+ company.
 *
 * Read-only: every query is a bounded SELECT through `buildSnapshotNameQuery`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { OfficialSourceResolver } from '@/server/agents/prospect-intake';
import type { OfficialSourceResolverInput } from '@/server/agents/prospect-intake/source-enrichment';
import { createFallbackOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/fallback-official-source-resolver';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import { buildSnapshotNameQuery } from '@/server/prospect-batches/snapshot-name-query';
import {
  normalizeEcCompanyCore,
  stripEcCountrySuffix,
} from '@/server/source-catalog/connectors/ec-scvs/ec-company-name-core';
import { normalizeEcEntityCore } from '@/server/source-catalog/connectors/ec-scvs/ec-entity-name-core';
import {
  EC_SCVS_ALIAS_REGISTRY_SOURCE_KEY,
  EC_SCVS_REGISTRY_SOURCE_KEY,
} from '@/server/source-catalog/connectors/ec-scvs/ec-scvs-registry-rows';
import {
  EC_SRI_REGISTRY_SOURCE_KEY,
  EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY,
} from '@/server/source-catalog/connectors/ec-scvs/ec-sri-registry-rows';

/**
 * Society RUC: valid province, third digit 9 (private) or 6 (public), principal
 * establishment 001. A natural person's RUC (third digit 0-5) is their cédula:
 * never offered as a company's RUC.
 */
export const EC_SOCIETY_RUC = /^(0[1-9]|1[0-9]|2[0-4]|30)[69]\d{7}001$/;

/** A bare brand is strong only for a company this large (Agent 1 ICP size floor). */
export const EC_LARGE_COMPANY_STRONG_MIN_WORKERS = 200;

/** The July Superintendencia snapshot (`bi_compania`), filled with `normalizeEcCompanyCore`. */
export const EC_SCVS_LEGACY_SOURCE_KEY = 'ec_scvs' as const;

/** Build the Ecuador resolver chain over one read-only (service-role) client. */
export function buildEcuadorOfficialSourceResolver(snapshotClient: SupabaseClient): OfficialSourceResolver {
  const byName = (sourceKey: string, normalizeCore: (name: string | null | undefined) => string, signalOnly = false) =>
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'EC',
      sourceKey,
      taxIdentifierType: 'RUC',
      validTaxId: EC_SOCIETY_RUC,
      normalizeCore,
      querySnapshots: buildSnapshotNameQuery(snapshotClient, sourceKey, 'EC', { withWorkforce: true }),
      singleWordIsSignalOnly: true,
      largeCompanyStrongMinWorkers: EC_LARGE_COMPANY_STRONG_MIN_WORKERS,
      ...(signalOnly ? { signalOnly: true } : {}),
    });

  const current = (last: OfficialSourceResolver) =>
    createFallbackOfficialSourceResolver(
      byName(EC_SCVS_REGISTRY_SOURCE_KEY, normalizeEcCompanyCore),
      createFallbackOfficialSourceResolver(
        byName(EC_SCVS_ALIAS_REGISTRY_SOURCE_KEY, normalizeEcCompanyCore),
        createFallbackOfficialSourceResolver(
          byName(EC_SRI_REGISTRY_SOURCE_KEY, normalizeEcEntityCore),
          last,
        ),
      ),
    );
  const tradeName = () => byName(EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY, normalizeEcEntityCore, true);

  return createFallbackOfficialSourceResolver(
    current(
      createFallbackOfficialSourceResolver(tradeName(), byName(EC_SCVS_LEGACY_SOURCE_KEY, normalizeEcCompanyCore)),
    ),
    withoutCountrySuffix(current(tradeName())),
  );
}

/** The same lookup, asked with the candidate's name without «Ecuador» / «Ec» at the end. */
export function withoutCountrySuffix(inner: OfficialSourceResolver): OfficialSourceResolver {
  const renamed = (input: OfficialSourceResolverInput): OfficialSourceResolverInput | null => {
    const shorter = stripEcCountrySuffix(input.candidate.canonicalName);
    return shorter === null ? null : { ...input, candidate: { ...input.candidate, canonicalName: shorter } };
  };
  return {
    countryCode: inner.countryCode,
    sourceKey: inner.sourceKey,
    canResolve(input) {
      const next = renamed(input);
      return next !== null && inner.canResolve(next);
    },
    resolve(input) {
      const next = renamed(input);
      if (next === null) throw new Error('ec_country_suffix_resolver_called_without_suffix');
      return inner.resolve(next);
    },
  };
}

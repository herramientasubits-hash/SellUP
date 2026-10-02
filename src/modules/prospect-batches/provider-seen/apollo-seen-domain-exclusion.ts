/**
 * apollo-seen-domain-exclusion.ts — qué dominios le pedimos a Apollo que NO
 * devuelva, y por qué.
 *
 * AGENT1-APOLLO-SEEN-DOMAIN-EXCLUSION-1.
 *
 * ── El problema ───────────────────────────────────────────────────────────────
 *
 * Para los mismos criterios Apollo devuelve SIEMPRE la misma página, y la cobra.
 * SellUp nunca guarda empresas como Accounts en Apollo, así que
 * `prospected_by_current_team=no` no las aparta: las aparta después nuestra
 * propia memoria, cuando el crédito ya se pagó. Una búsqueda agotada sigue
 * cobrando 1 crédito por traer empresas que vamos a descartar.
 *
 * ── El contrato ───────────────────────────────────────────────────────────────
 *
 * `not_organization_websites_list[]` está documentado en la especificación
 * OpenAPI oficial de Organization Search (docs.apollo.io, consultada el
 * 2026-09-28): excluye las empresas de esos dominios —y sus otros dominios
 * conocidos— «without retrieving and enriching them first». Apollo Support
 * (2026-09-24) confirmó que una página vacía no se cobra.
 *
 * ── Qué se excluye ────────────────────────────────────────────────────────────
 *
 *   1. Lo que YA ES NUESTRO: `dedupeAuthorityValues` del plan —hoy `accounts`
 *      del país y lo aceptado por la fuente gratuita; 🔴 NO incluye HubSpot ni
 *      candidatos, aunque este comentario lo afirmaba— más, desde
 *      AGENT1-APOLLO-SEEN-DOMAIN-EXCLUSION-SCOPE-1, los candidatos VIVOS de SellUp
 *      en el país (`sellupLiveDomains`), de cualquier vendedor: con «una empresa,
 *      un vendedor» nunca pueden volver a ser un candidato nuevo.
 *   2. Lo que PAGAMOS POR VER hace poco (memoria provider-seen, últimos
 *      `APOLLO_SEEN_EXCLUSION_COOLDOWN_DAYS`). 🔴 NO es autoridad de dedupe: ahí
 *      caen también empresas que sólo sobraron del objetivo o que un gate
 *      rechazó cuando tenía un defecto ya corregido. Por eso la exclusión es
 *      TEMPORAL: pasado el enfriamiento vuelven a aparecer y se evalúan con los
 *      gates de ese día. Sin fecha fiable, un dominio visto NO se excluye.
 *      🔴 SCOPE-1 — y lo que en SellUp sólo existe DESCARTADO
 *      (`releasedDomains`) tampoco: el descarte libera la empresa para los demás
 *      vendedores, y ocultarla 30 días contradecía esa regla.
 *
 * Con tope, primero va lo nuestro y después lo visto más reciente. El orden
 * dentro de cada grupo es determinista: dos corridas idénticas piden lo mismo.
 *
 * Puro: sin env, sin I/O; el reloj entra por parámetro.
 */

import type { ProviderSeenMemory } from './provider-seen-identity';

/** Enfriamiento de lo ya visto: pasado este plazo, vuelve a poder aparecer. */
export const APOLLO_SEEN_EXCLUSION_COOLDOWN_DAYS = 30;

/** Mismo tope que el contrato de la petición (`APOLLO_MAX_EXCLUDED_DOMAINS`). */
export const APOLLO_SEEN_EXCLUSION_DOMAIN_CAP = 500;

const MS_PER_DAY = 86_400_000;

export type ApolloSeenDomainExclusionInput = {
  enabled: boolean;
  /** Dominios con procedencia que prueba propiedad (ya normalizados). */
  authorityDomains: readonly string[];
  /** Memoria provider-seen de Apollo; `null` ⇒ no se cargó. */
  providerSeenMemory: ProviderSeenMemory | null;
  /** SCOPE-1 — candidatos VIVOS de SellUp en el país: se excluyen como lo nuestro. */
  sellupLiveDomains?: readonly string[];
  /** SCOPE-1 — vistos que en SellUp sólo están descartados: NO se excluyen. */
  releasedDomains?: readonly string[];
  /**
   * SAME-INDUSTRY-1 — vistos que TODO lo que se sabe de ellos sitúa en otro país
   * u otra industria: no ocupan sitio en la lista. Ausente ⇒ se excluyen todos.
   */
  outOfScopeSeenDomains?: readonly string[];
  /** SAME-INDUSTRY-1 — vivos del país que el lector dejó fuera por ser de otra industria (sólo telemetría). */
  liveOutOfScopeCount?: number;
  /**
   * KNOWN-REJECTED-1 — ya entregados por SellUp que los filtros gratuitos de
   * Apollo rechazarían siempre. Van al FINAL, después de lo visto.
   */
  knownRejectedDomains?: readonly string[];
  now: Date;
  cooldownDays?: number;
  cap?: number;
};

export type ApolloSeenDomainExclusionTelemetry = {
  enabled: boolean;
  sent: number;
  from_authority: number;
  /** SCOPE-1 — de `from_authority`, cuántos vinieron de candidatos vivos (y no de cuentas). */
  from_sellup_live: number;
  from_recent_seen: number;
  /** SCOPE-1 — vistos que NO se excluyen porque en SellUp sólo están descartados. */
  seen_released_by_discard: number;
  /** SAME-INDUSTRY-1 — vistos que NO se excluyen por ser de otro país u otra industria. */
  seen_out_of_scope: number;
  /** SAME-INDUSTRY-1 — vivos del país que NO se excluyen por ser de otra industria. */
  live_out_of_scope: number;
  /** KNOWN-REJECTED-1 — enviados por ser ya entregados que Apollo rechazaría gratis. */
  from_known_rejected: number;
  /** Vistas pero fuera del enfriamiento: pueden volver a aparecer. */
  seen_outside_cooldown: number;
  /** Vistas sin fecha fiable: no se excluyen. */
  seen_without_date: number;
  omitted_due_to_cap: number;
  cooldown_days: number;
};

export type ApolloSeenDomainExclusion = {
  domains: string[];
  telemetry: ApolloSeenDomainExclusionTelemetry;
};

function normalizeDomain(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveApolloSeenDomainExclusion(
  input: ApolloSeenDomainExclusionInput,
): ApolloSeenDomainExclusion {
  const cooldownDays = input.cooldownDays ?? APOLLO_SEEN_EXCLUSION_COOLDOWN_DAYS;
  const cap = Math.max(0, Math.trunc(input.cap ?? APOLLO_SEEN_EXCLUSION_DOMAIN_CAP));

  if (!input.enabled) {
    return {
      domains: [],
      telemetry: {
        enabled: false,
        sent: 0,
        from_authority: 0,
        from_sellup_live: 0,
        from_recent_seen: 0,
        seen_released_by_discard: 0,
        seen_out_of_scope: 0,
        live_out_of_scope: 0,
        from_known_rejected: 0,
        seen_outside_cooldown: 0,
        seen_without_date: 0,
        omitted_due_to_cap: 0,
        cooldown_days: cooldownDays,
      },
    };
  }

  const accountDomains = new Set(
    input.authorityDomains.map(normalizeDomain).filter((d): d is string => d !== null),
  );
  const liveOnly = (input.sellupLiveDomains ?? [])
    .map(normalizeDomain)
    .filter((d): d is string => d !== null && !accountDomains.has(d));
  const authority = [...new Set([...accountDomains, ...liveOnly])].sort();
  const authoritySet = new Set(authority);
  const liveOnlySet = new Set(liveOnly);
  const released = new Set(
    (input.releasedDomains ?? []).map(normalizeDomain).filter((d): d is string => d !== null),
  );

  const outOfScope = new Set(
    (input.outOfScopeSeenDomains ?? []).map(normalizeDomain).filter((d): d is string => d !== null),
  );

  const cutoff = input.now.getTime() - cooldownDays * MS_PER_DAY;
  const recentSeen: { domain: string; seenAt: number }[] = [];
  let seenOutsideCooldown = 0;
  let seenWithoutDate = 0;
  let seenReleasedByDiscard = 0;
  let seenOutOfScope = 0;
  for (const raw of input.providerSeenMemory?.normalizedDomains ?? []) {
    const domain = normalizeDomain(raw);
    if (domain === null || authoritySet.has(domain)) continue;
    if (released.has(domain)) {
      seenReleasedByDiscard++;
      continue;
    }
    if (outOfScope.has(domain)) {
      seenOutOfScope++;
      continue;
    }
    const seenAtRaw = input.providerSeenMemory?.domainLastSeenAt?.get(raw);
    const seenAt = typeof seenAtRaw === 'string' ? Date.parse(seenAtRaw) : Number.NaN;
    if (Number.isNaN(seenAt)) {
      seenWithoutDate++;
      continue;
    }
    if (seenAt < cutoff) {
      seenOutsideCooldown++;
      continue;
    }
    recentSeen.push({ domain, seenAt });
  }
  // Lo visto más reciente primero; empate ⇒ orden alfabético.
  recentSeen.sort((a, b) => b.seenAt - a.seenAt || a.domain.localeCompare(b.domain));

  const head = [...authority, ...recentSeen.map((entry) => entry.domain)];
  const headSet = new Set(head);
  const knownRejected = [
    ...new Set(
      (input.knownRejectedDomains ?? [])
        .map(normalizeDomain)
        .filter((d): d is string => d !== null && !headSet.has(d) && !released.has(d)),
    ),
  ].sort();
  const ordered = [...head, ...knownRejected];
  const domains = ordered.slice(0, cap);
  const fromAuthority = Math.min(authority.length, domains.length);
  const fromKnownRejected = Math.max(0, domains.length - head.length);
  const fromSellupLive = domains.slice(0, fromAuthority).filter((d) => liveOnlySet.has(d)).length;

  return {
    domains,
    telemetry: {
      enabled: true,
      sent: domains.length,
      from_authority: fromAuthority,
      from_sellup_live: fromSellupLive,
      from_recent_seen: domains.length - fromAuthority - fromKnownRejected,
      seen_released_by_discard: seenReleasedByDiscard,
      seen_out_of_scope: seenOutOfScope,
      live_out_of_scope: Math.max(0, Math.trunc(input.liveOutOfScopeCount ?? 0)),
      from_known_rejected: fromKnownRejected,
      seen_outside_cooldown: seenOutsideCooldown,
      seen_without_date: seenWithoutDate,
      omitted_due_to_cap: ordered.length - domains.length,
      cooldown_days: cooldownDays,
    },
  };
}

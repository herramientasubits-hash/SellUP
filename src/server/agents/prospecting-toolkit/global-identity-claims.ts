/**
 * AGENT1-GLOBAL-COMPANY-IDENTITY-CLAIMS-1 — qué señal reclama un candidato,
 * fuera del lote.
 *
 * Decisión de producto 2026-09-28: una empresa ya propuesta en SellUp —para
 * CUALQUIER vendedor, en CUALQUIER lote— deja de contar para otro. La
 * migración 126 (CUT-3B4) sólo cerró la carrera DENTRO de un mismo lote; esta
 * pieza + la 140 cierran la misma carrera a escala de TODO SellUp.
 *
 * ── Qué NO hace este módulo ───────────────────────────────────────────────────
 *
 *   · No decide TIER, no compara candidatos entre sí, no hace I/O.
 *     Eso es exactamente lo que `batch-identity-registry.ts` ya hace DENTRO de
 *     un lote; este módulo no lo duplica.
 *   · No enforce nada: la ATOMICIDAD real es el índice único parcial de la
 *     migración 140 (`(claim_type, claim_key) WHERE released_at IS NULL`).
 *     Esta función sólo dice QUÉ reclamar; quién gana la carrera lo decide
 *     PostgreSQL, no TypeScript.
 *
 * ── Por qué el dominio NO se reclama cuando hay identidad fiscal ─────────────
 *
 * La migración 126 rechazó `UNIQUE(domain)` porque dos personas jurídicas
 * DISTINTAS pueden compartir dominio de grupo legítimamente (TIER 0). Reclamar
 * el dominio en exclusiva SIEMPRE repetiría ese error a escala global. La
 * misma precedencia que TIER 1 > TIER 2 ya usa dentro del lote se repite aquí:
 * con identidad fiscal, el dominio no es la señal exclusiva —la fiscal ya
 * identifica a la persona jurídica sin ambigüedad—; sin ella, el dominio es la
 * mejor señal disponible y se reclama, con el mismo margen de error que TIER 2
 * ya acepta hoy (no es una regresión: es la misma imperfección, ahora
 * permanente en vez de expirar a los 30 días).
 */

import type { CompanyIdentityEvidence } from './company-identity-evidence';

export const GLOBAL_IDENTITY_CLAIM_TYPES = [
  'fiscal',
  'domain',
  'provider_entity',
  'linkedin',
] as const;

export type GlobalIdentityClaimType = (typeof GLOBAL_IDENTITY_CLAIM_TYPES)[number];

export type GlobalIdentityClaim = {
  type: GlobalIdentityClaimType;
  key: string;
};

/**
 * AGENT1-CLAIMS-IDENTITY-DOMAIN-CROSSCHECK-1 — lo que viaja a la 152 por candidato.
 *
 * 🔴 El defecto que cierra: el vendedor A (Apollo, sin NIT) reclamaba
 * `domain:acme.com.co`; el vendedor B (Tavily/Claude/banco, CON NIT) reclamaba
 * `fiscal:CO:…` y NO el dominio. Dos claves distintas ⇒ el índice único no veía
 * nada y la MISMA empresa quedaba para los dos.
 *
 * Ahora el dominio y el LinkedIn de identidad viajan SIEMPRE (con o sin fiscal)
 * como señales de CRUCE: la 152 los guarda en cada reclamo y, bajo un cerrojo por
 * señal, trata como choque un reclamo ACTIVO de otro candidato con el mismo
 * dominio/LinkedIn — SALVO que los dos tengan identidad fiscal y sea DISTINTA
 * (filiales del mismo grupo, TIER 0). La exclusividad por índice único sigue
 * siendo la de antes para lo que se reclama en `claims`.
 */
export type GlobalIdentityClaimEnvelope = {
  claims: GlobalIdentityClaim[];
  /** Dominio de identidad (`normalizeIdentityDomain`); nunca un host compartido. */
  identityDomain: string | null;
  /** LinkedIn de empresa normalizado. */
  identityLinkedIn: string | null;
};

/**
 * Deriva los reclamos globales de un candidato a partir de su evidencia YA
 * calculada (`buildCompanyIdentityEvidence` / `toRegisteredBatchIdentity`).
 *
 * Devuelve `claims: []` cuando no hay ninguna señal fuerte: un candidato así no
 * puede chocar con nadie y se admite exactamente como hoy.
 */
export function deriveGlobalIdentityClaimEnvelope(
  evidence: CompanyIdentityEvidence,
): GlobalIdentityClaimEnvelope {
  const claims: GlobalIdentityClaim[] = [];
  const hasFiscal = Boolean(evidence.fiscalIdentityKey);

  // Fiscal manda; sin ella, el dominio es la mejor señal disponible.
  if (evidence.fiscalIdentityKey) {
    claims.push({ type: 'fiscal', key: evidence.fiscalIdentityKey });
  } else if (evidence.normalizedDomain) {
    claims.push({ type: 'domain', key: evidence.normalizedDomain });
  }

  // El id de proveedor identifica una entidad concreta, no un grupo.
  if (evidence.providerEntityKey) {
    claims.push({ type: 'provider_entity', key: evidence.providerEntityKey });
  }

  // 🔴 AGENT1-CLAIMS-LINKEDIN-SUBSIDIARIES-1 — con identidad fiscal el LinkedIn NO
  // se reclama en exclusiva: las fuentes suelen dar a una filial (NIT propio) el
  // LinkedIn de la matriz, y el índice único las hacía chocar aunque fueran dos
  // personas jurídicas distintas. Sigue viajando como señal de CRUCE
  // (`identityLinkedIn`), con la misma excepción de fiscal distinta que el dominio.
  if (evidence.normalizedLinkedInCompany && !hasFiscal) {
    claims.push({ type: 'linkedin', key: evidence.normalizedLinkedInCompany });
  }

  return {
    claims,
    identityDomain: evidence.normalizedDomain ?? null,
    identityLinkedIn: evidence.normalizedLinkedInCompany ?? null,
  };
}

/** Sólo los reclamos exclusivos (el banco y los llamadores previos a la 152). */
export function deriveGlobalIdentityClaims(
  evidence: CompanyIdentityEvidence,
): GlobalIdentityClaim[] {
  return deriveGlobalIdentityClaimEnvelope(evidence).claims;
}

/**
 * AGENT1-CLAIMS-ONLY-LIVE-CANDIDATES-1 — los status que LIBERAN reclamos.
 *
 * Son exactamente los del disparador de la migración 140
 * (`IF NEW.status IN ('discarded', 'duplicate')`). Una prueba estática compara
 * esta lista con el SQL para que no puedan divergir.
 */
export const GLOBAL_IDENTITY_RELEASING_STATUSES = ['discarded', 'duplicate'] as const;

/**
 * ¿Puede una fila con este status ocupar señales globales?
 *
 * El disparador sólo libera en un UPDATE de status. Una fila que se INSERTA ya
 * como `duplicate` (p. ej. «ya existe en HubSpot») o `discarded` nunca pasa por
 * ese UPDATE, así que si reclamara, su reclamo no se liberaría jamás y la
 * empresa quedaría apartada para todos. Medido en Producción el 2026-09-29:
 * World Vision Perú (lote `701ffe78`), insertada como `duplicate` y con 2
 * reclamos activos.
 *
 * Un status ausente o desconocido NO reclama: reclamar de más aparta empresas
 * para siempre; reclamar de menos sólo deja la carrera como estaba antes de 140.
 */
export function isGlobalIdentityClaimableStatus(status: unknown): boolean {
  if (typeof status !== 'string' || status.trim() === '') return false;
  return !(GLOBAL_IDENTITY_RELEASING_STATUSES as readonly string[]).includes(status.trim());
}

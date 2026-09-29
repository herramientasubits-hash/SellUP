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
 * Deriva los reclamos globales de un candidato a partir de su evidencia YA
 * calculada (`buildCompanyIdentityEvidence` / `toRegisteredBatchIdentity`).
 *
 * Devuelve `[]` cuando no hay ninguna señal fuerte: un candidato así no puede
 * chocar con nadie y se admite exactamente como hoy.
 */
export function deriveGlobalIdentityClaims(
  evidence: CompanyIdentityEvidence,
): GlobalIdentityClaim[] {
  const claims: GlobalIdentityClaim[] = [];

  // Fiscal manda; sin ella, el dominio es la mejor señal disponible.
  if (evidence.fiscalIdentityKey) {
    claims.push({ type: 'fiscal', key: evidence.fiscalIdentityKey });
  } else if (evidence.normalizedDomain) {
    claims.push({ type: 'domain', key: evidence.normalizedDomain });
  }

  // Éstas nunca chocan con el caso de subsidiarias compartiendo dominio: el id
  // de proveedor y el LinkedIn de empresa identifican una entidad concreta,
  // no un grupo.
  if (evidence.providerEntityKey) {
    claims.push({ type: 'provider_entity', key: evidence.providerEntityKey });
  }
  if (evidence.normalizedLinkedInCompany) {
    claims.push({ type: 'linkedin', key: evidence.normalizedLinkedInCompany });
  }

  return claims;
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

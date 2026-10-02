/**
 * company-bank-types.ts — el vocabulario del BANCO de empresas del Agente 1.
 *
 * AGENT1-COMPANY-BANK-FOUNDATION-1. Ver `docs/agent1/COMPANY_BANK_DESIGN.md`.
 *
 * Puro: sin env, sin I/O. Los valores de aquí son los MISMOS que valida la
 * migración 142 (`supabase/migrations/142_agent1_company_bank.sql`); una prueba
 * estática los compara para que no puedan divergir.
 */

import type { GlobalIdentityClaimType } from '@/server/agents/prospecting-toolkit/global-identity-claims';

/** 'ready' = completa y aceptable para el objetivo; 'to_complete' = le falta algún dato. */
export const COMPANY_BANK_TIERS = ['ready', 'to_complete'] as const;
export type CompanyBankTier = (typeof COMPANY_BANK_TIERS)[number];

/** Quién la encontró. Vocabulario CERRADO (una fuente nueva llega con su migración). */
export const COMPANY_BANK_SOURCE_PROVIDERS = ['apollo', 'lusha', 'tavily', 'free_source'] as const;
export type CompanyBankSourceProvider = (typeof COMPANY_BANK_SOURCE_PROVIDERS)[number];

/** Resultados de cerrar una extracción. */
export const COMPANY_BANK_SETTLE_OUTCOMES = ['assigned', 'invalidated', 'released'] as const;
export type CompanyBankSettleOutcome = (typeof COMPANY_BANK_SETTLE_OUTCOMES)[number];

/** Días que una empresa puede esperar en el banco (la 142 acota a 1–180). */
export const COMPANY_BANK_DEFAULT_TTL_DAYS = 60;
export const COMPANY_BANK_MIN_TTL_DAYS = 1;
export const COMPANY_BANK_MAX_TTL_DAYS = 180;

/** Máximo de empresas por extracción (la 142 acota a 50). */
export const COMPANY_BANK_MAX_DRAW = 50;

/** Cuánto se reserva una extracción antes de que otra pueda tomar la fila (la 142: 30–3600). */
export const COMPANY_BANK_DEFAULT_RESERVE_SECONDS = 300;

/** Tamaño de un envío de depósito: un fallo de red no pierde más que un trozo. */
export const COMPANY_BANK_DEPOSIT_CHUNK = 50;

/** Tope de la fila (la 142: `pg_column_size(payload) <= 16384`). Se comprueba antes de enviar. */
export const COMPANY_BANK_MAX_PAYLOAD_BYTES = 16 * 1024;

export type CompanyBankClaim = { type: GlobalIdentityClaimType; key: string };

export type CompanyBankDepositItem = {
  countryCode: string;
  macroIndustryKey: string;
  tier: CompanyBankTier;
  sourceProvider: CompanyBankSourceProvider;
  /** Las claves de reclamo EXACTAS (`deriveGlobalIdentityClaims`). Al menos una. */
  claims: readonly CompanyBankClaim[];
  /** Lo necesario para reconstruir el candidato al asignarlo. */
  payload: Record<string, unknown>;
  /** Vacío ⇔ `ready`. */
  missingFields: readonly string[];
  sourceBatchId?: string | null;
  ttlDays?: number;
};

export type CompanyBankDepositResult =
  | {
      status: 'ok';
      deposited: number;
      skippedClaimed: number;
      skippedInBank: number;
      /** Rechazadas por la base de datos (formato) MÁS las descartadas antes de enviar. */
      skippedInvalid: number;
    }
  | { status: 'unavailable'; reason: string };

export type CompanyBankDrawnCompany = {
  id: string;
  tier: CompanyBankTier;
  sourceProvider: CompanyBankSourceProvider;
  claims: CompanyBankClaim[];
  payload: Record<string, unknown>;
  missingFields: string[];
  sourceBatchId: string | null;
  bankedAt: string;
};

export type CompanyBankDrawResult =
  | { status: 'ok'; drawId: string; companies: CompanyBankDrawnCompany[] }
  | { status: 'unavailable'; reason: string };

export type CompanyBankSettleItem =
  | { id: string; outcome: 'assigned'; batchId: string; candidateId: string }
  | { id: string; outcome: 'invalidated'; reason: string }
  | { id: string; outcome: 'released' };

export type CompanyBankSettleResult =
  | { status: 'ok'; assigned: number; invalidated: number; released: number; ignored: number }
  | { status: 'unavailable'; reason: string };

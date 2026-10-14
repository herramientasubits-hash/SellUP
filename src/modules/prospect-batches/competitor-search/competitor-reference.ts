/**
 * Agente 1 · «Competidores de una empresa» — la empresa de REFERENCIA (puro).
 *
 * La vendedora elige una empresa (de Cuentas o escribiendo su nombre o su web);
 * SellUp arma su ficha y busca empresas que le compiten. Este módulo define la
 * forma de esa referencia, cómo viaja del asistente al servidor y cómo queda en
 * el lote (`prospect_batches.metadata.competitor_search`).
 *
 * Lo usan el cliente (asistente) y el servidor (ejecución y búsqueda de Claude):
 * sin I/O ni dependencias de servidor.
 */

import { z } from 'zod';
import { detectPromptInjection } from '@/modules/industry-catalog/schema';

export const COMPETITOR_SEARCH_METADATA_KEY = 'competitor_search';

export const COMPETITOR_REFERENCE_LIMITS = {
  nameMaxChars: 120,
  domainMaxChars: 253,
  descriptionMaxChars: 300,
} as const;

/** Lo que la búsqueda necesita saber de la empresa de referencia. */
export type CompetitorReference = {
  /** Nombre comercial. */
  name: string;
  /** Dominio propio (`alpina.com`), o null si no se encontró. */
  domain: string | null;
  /** Qué vende y a quién, en una frase. Orienta la búsqueda; null si no se sabe. */
  description: string | null;
  /** La cuenta de SellUp de la que salió, si salió de Cuentas. */
  accountId: string | null;
};

/**
 * La ficha que ve la vendedora para confirmar: la referencia más el país y la
 * industria del catálogo que se le proponen para la búsqueda (puede cambiarlos).
 */
export type CompetitorReferenceCard = CompetitorReference & {
  countryCode: string | null;
  industryId: string | null;
};

/** Espacios y saltos de línea colapsados: el texto va dentro de un prompt. */
export function collapseReferenceText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** `https://www.Alpina.com/es` → `alpina.com`; lo que no parece un dominio → null. */
export function normalizeReferenceDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
  if (!host || host.length > COMPETITOR_REFERENCE_LIMITS.domainMaxChars) return null;
  return DOMAIN_PATTERN.test(host) ? host : null;
}

const referenceText = (max: number) =>
  z
    .string()
    .transform(collapseReferenceText)
    .pipe(z.string().min(1).max(max))
    .refine((text) => !detectPromptInjection(text), 'El texto de la empresa de referencia no es válido.');

/**
 * Lo que el asistente envía al servidor. `.strict()` como el resto de la
 * solicitud: un campo de más invalida la petición entera.
 */
export const competitorReferenceSchema = z
  .object({
    name: referenceText(COMPETITOR_REFERENCE_LIMITS.nameMaxChars),
    domain: z
      .string()
      .max(COMPETITOR_REFERENCE_LIMITS.domainMaxChars)
      .nullable()
      .transform((value) => normalizeReferenceDomain(value)),
    description: referenceText(COMPETITOR_REFERENCE_LIMITS.descriptionMaxChars).nullable(),
    accountId: z.string().uuid().nullable(),
  })
  .strict();

/** La forma que queda en el lote. */
export function toCompetitorSearchMetadata(reference: CompetitorReference): Record<string, unknown> {
  return {
    reference: {
      name: reference.name,
      domain: reference.domain,
      description: reference.description,
      account_id: reference.accountId,
    },
  };
}

function readString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = collapseReferenceText(value);
  return text && text.length <= max ? text : null;
}

/**
 * Lee la referencia desde la metadata de un lote. Lo que viene de la base es dato
 * no confiable: se revalida y, si algo no cuadra, `null` (el lote se trata como
 * una búsqueda por criterios).
 */
export function readCompetitorReference(metadata: unknown): CompetitorReference | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const block = (metadata as Record<string, unknown>)[COMPETITOR_SEARCH_METADATA_KEY];
  if (typeof block !== 'object' || block === null) return null;
  const reference = (block as Record<string, unknown>).reference;
  if (typeof reference !== 'object' || reference === null) return null;
  const raw = reference as Record<string, unknown>;
  const name = readString(raw.name, COMPETITOR_REFERENCE_LIMITS.nameMaxChars);
  if (!name || detectPromptInjection(name)) return null;
  const description = readString(raw.description, COMPETITOR_REFERENCE_LIMITS.descriptionMaxChars);
  return {
    name,
    domain: normalizeReferenceDomain(typeof raw.domain === 'string' ? raw.domain : null),
    description: description && !detectPromptInjection(description) ? description : null,
    accountId: typeof raw.account_id === 'string' ? raw.account_id : null,
  };
}

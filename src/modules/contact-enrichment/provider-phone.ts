// «Teléfono Apollo / Lusha» — el número que trajo un proveedor cuando la persona ya tenía
// uno de HubSpot (o escrito a mano). Puro, sin dependencias.
//
// Migración 164: un teléfono sin procedencia de proveedor no se reemplaza por uno de
// Apollo / Lusha (feedback de un líder comercial, 11-11: «puede que el de Apollo o Lusha
// esté mal»). El del proveedor se guarda aparte en `provider_phone` — en
// `enrichment_metadata` del candidato y en `metadata` del contacto oficial — y la UI lo
// muestra en su propia casilla.

export const PROVIDER_PHONE_LABEL = 'Teléfono Apollo / Lusha';

export interface ProviderPhone {
  number: string;
  type: string | null;
  source: string | null;
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Lee `provider_phone` de una metadata (de candidato o de contacto). Devuelve `null` si no
 * hay número, o si es el mismo que ya se muestra en «Teléfono» (`shownPhone`).
 */
export function readProviderPhone(metadata: unknown, shownPhone?: string | null): ProviderPhone | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>).provider_phone;
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const number = cleanString(entry.number);
  if (!number) return null;
  const digits = (value: string): string => value.replace(/\D+/g, '');
  const shown = cleanString(shownPhone);
  if (shown && digits(shown) === digits(number)) return null;
  return { number, type: cleanString(entry.type), source: cleanString(entry.source) };
}

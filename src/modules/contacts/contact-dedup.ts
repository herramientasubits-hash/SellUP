// Deduplicación server-side de contactos dentro de una cuenta — Hito 17A.7D
//
// Lógica pura sin red ni DB. Las dependencias (carga de contactos existentes)
// se inyectan desde actions.ts para poder testear sin Supabase.
//
// Reglas:
//   Prioridad 1 — Email exacto (normalizado) dentro de la misma account_id.
//   Prioridad 2 — LinkedIn URL (normalizada) dentro de la misma account_id.
//   Prioridad 3 — Nombre completo (normalizado) SOLO cuando el nuevo contacto
//                 no tiene email ni linkedin; si tiene alguno se omite el nombre.

// ── Normalización de claves ───────────────────────────────────────

export function emailKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value.trim().toLowerCase();
  return k.length > 0 ? k : null;
}

export function linkedinKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value.trim().toLowerCase().replace(/\/+$/, '');
  return k.length > 0 ? k : null;
}

export function nameKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
  return k.length > 0 ? k : null;
}

// ── Tipos ─────────────────────────────────────────────────────────

export interface ExistingContactForDedup {
  id: string;
  email: string | null;
  linkedin_url: string | null;
  full_name: string;
}

export interface ContactDedupInput {
  email: string | null | undefined;
  linkedin_url: string | null | undefined;
  full_name: string;
}

export type DedupMatchedBy = 'email' | 'linkedin' | 'name';

export interface DedupMatch {
  contactId: string;
  matchedBy: DedupMatchedBy;
}

// ── Core de deduplicación ─────────────────────────────────────────

/**
 * Devuelve el primer contacto existente que duplique al input, o null si no hay.
 * Orden: email → linkedin → nombre (solo si no hay email ni linkedin).
 */
export function findContactDuplicate(
  input: ContactDedupInput,
  existing: ExistingContactForDedup[],
): DedupMatch | null {
  const eKey = emailKey(input.email);
  const lKey = linkedinKey(input.linkedin_url);
  const nKey = nameKey(input.full_name);

  if (eKey) {
    const match = existing.find((c) => emailKey(c.email) === eKey);
    if (match) return { contactId: match.id, matchedBy: 'email' };
  }

  if (lKey) {
    const match = existing.find((c) => linkedinKey(c.linkedin_url) === lKey);
    if (match) return { contactId: match.id, matchedBy: 'linkedin' };
  }

  // Fallback por nombre solo cuando el input no tiene email ni linkedin.
  if (!eKey && !lKey && nKey) {
    const match = existing.find((c) => nameKey(c.full_name) === nKey);
    if (match) return { contactId: match.id, matchedBy: 'name' };
  }

  return null;
}

// ── Mensajes de error ─────────────────────────────────────────────

const DEDUP_ERRORS: Record<DedupMatchedBy, string> = {
  email: 'Ya existe un contacto con este email en esta cuenta.',
  linkedin: 'Ya existe un contacto con este LinkedIn en esta cuenta.',
  name: 'Ya existe un contacto con este nombre en esta cuenta.',
};

export function dedupErrorMessage(matchedBy: DedupMatchedBy): string {
  return DEDUP_ERRORS[matchedBy];
}

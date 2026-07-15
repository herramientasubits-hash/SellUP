/**
 * Regression — Lusha cross-run pending candidate dedup
 * (Agente 2A, Hito 17B.4X.7C.3H.3)
 *
 * Contexto: el bug live de Siesa (Camila Fino Morales duplicada como
 * pending_review en dos runs) se originó en el runner de Apollo, que NO
 * comparaba contra contact_enrichment_candidates de otros runs. Este hito
 * NO modifica lusha-enrichment-runner.ts — solo Apollo (contact-candidate-writer.ts
 * + pending-candidate-cross-run-check.ts).
 *
 * Lusha YA tenía una verificación PARCIAL preexistente en
 * checkExactDuplicate() (lusha-enrichment-runner.ts, sección "Dedup helpers"):
 * consulta contact_enrichment_candidates WHERE status='pending_review' por
 * email o linkedin_url (normalizados, case-insensitive) ANTES de insertar un
 * candidato nuevo — sin filtrar por cuenta. Esta prueba documenta ese
 * comportamiento preexistente (sin tocar el archivo fuente) reimplementando
 * la MISMA normalización que usa la función real, siguiendo el estilo de
 * pruebas ya establecido en este archivo de tests
 * (ver lusha-enrichment-runner-17b4g.test.ts, tests 10/10b: "duplicate check
 * logic" documentado como lógica pura sin mock profundo de Supabase).
 *
 * Gap real de Lusha frente a Apollo (post-fix): no tiene fallback por
 * source_contact_id+source ni por full_name+title, y su query no filtra por
 * account_id (dedup global). Ver recomendación de seguimiento en el reporte
 * del hito 17B.4X.7C.3H.3 (parity con el fix de Apollo).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Misma normalización que emailKey/linkedinKey en lusha-enrichment-runner.ts
// (sección "Dedup helpers (email/linkedin exact)").
function emailKey(v: string | null | undefined): string | null {
  if (!v) return null;
  const k = v.trim().toLowerCase();
  return k || null;
}

function linkedinKey(v: string | null | undefined): string | null {
  if (!v) return null;
  const k = v.trim().toLowerCase().replace(/\/+$/, '');
  return k || null;
}

interface PendingRow {
  email: string | null;
  linkedin_url: string | null;
}

/**
 * Reimplementa el bloque "Check pending candidates (no account_id filter
 * needed)" de checkExactDuplicate() contra una lista en memoria — sin red,
 * sin Supabase real (mismo patrón que el resto de este archivo).
 */
function isDuplicateOfExistingPending(
  candidateEmail: string | null,
  candidateLinkedinUrl: string | null,
  existingPending: PendingRow[],
): boolean {
  const eKey = emailKey(candidateEmail);
  if (eKey && existingPending.some((p) => emailKey(p.email) === eKey)) return true;

  const lKey = linkedinKey(candidateLinkedinUrl);
  if (lKey && existingPending.some((p) => linkedinKey(p.linkedin_url) === lKey)) return true;

  return false;
}

describe('Lusha pending-candidate cross-run dedup (existing behavior, unmodified)', () => {
  it('email de un pending_review de un run ANTERIOR → se detecta como duplicado (no se re-inserta)', () => {
    const existingPending: PendingRow[] = [
      { email: 'camila.fino@siesa.com', linkedin_url: null }, // run anterior 70233177...
    ];
    const isDuplicate = isDuplicateOfExistingPending('Camila.Fino@Siesa.com', null, existingPending);
    assert.equal(isDuplicate, true, 'Lusha ya evita re-insertar por email cross-run (comportamiento preexistente)');
  });

  it('linkedin_url de un pending_review de un run ANTERIOR (con slash final) → se detecta como duplicado', () => {
    const existingPending: PendingRow[] = [
      { email: null, linkedin_url: 'https://linkedin.com/in/camilafino' },
    ];
    const isDuplicate = isDuplicateOfExistingPending(
      null,
      'https://linkedin.com/in/camilafino/',
      existingPending,
    );
    assert.equal(isDuplicate, true);
  });

  it('candidato genuinamente nuevo (sin email/linkedin coincidente) → NO se marca duplicado', () => {
    const existingPending: PendingRow[] = [{ email: 'otra.persona@siesa.com', linkedin_url: null }];
    const isDuplicate = isDuplicateOfExistingPending('nueva.persona@siesa.com', null, existingPending);
    assert.equal(isDuplicate, false);
  });

  it('GAP documentado: Lusha NO tiene fallback por full_name — dos filas con el mismo nombre pero sin email/linkedin en común NO se detectan (a diferencia del fix de Apollo)', () => {
    // Simula lo que le pasaría a Lusha si Camila no tuviera email/linkedin
    // capturado en el pending_review anterior: su check actual no compara
    // por nombre, así que NO detectaría el duplicado. Apollo, tras este
    // hito, sí lo detectaría vía findMatchingPendingCandidate (regla D).
    const existingPending: PendingRow[] = [{ email: null, linkedin_url: null }];
    const isDuplicate = isDuplicateOfExistingPending(null, null, existingPending);
    assert.equal(
      isDuplicate,
      false,
      'confirma el gap: sin señal fuerte (email/linkedin), el check actual de Lusha no detecta nada',
    );
  });
});

import { redirect } from 'next/navigation';

/**
 * Hito 16AB.17 — `/prospect-batches` redirige a `/prospects`.
 * El home oficial del módulo Prospectos es ahora `/prospects`.
 * Los batches siguen existiendo como estructura técnica interna.
 */
export default function ProspectBatchesPage() {
  redirect('/prospects');
}


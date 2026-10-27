import { z } from 'zod';
import { wizardExecutionRequestSchema } from '../chat-wizard-execution/wizard-execution-schema';
import { BULK_TARGET_OPTIONS } from './bulk-search-types';

/**
 * Lo que la pantalla manda para crear una búsqueda masiva. Estricto: un campo
 * de más invalida la petición entera.
 *
 * Los criterios son los de una corrida normal del asistente y se validan con SU
 * esquema (`wizardExecutionRequestSchema`), que sigue SIN campo de cantidad: la
 * cantidad vive sólo aquí. Sólo «Empresas por criterios»: proveedores y
 * competidores tienen su propio flujo.
 */
export const bulkSearchCreateSchema = z
  .object({
    criteria: z.record(z.string(), z.unknown()),
    targetCount: z
      .number()
      .int()
      .refine((value) => (BULK_TARGET_OPTIONS as readonly number[]).includes(value), 'Elige 25, 50, 100 o 200.'),
    /** El tope que vio y confirmó Growth. El servidor lo recalcula: nunca autoriza por sí solo. */
    confirmedCreditCap: z.number().finite().nonnegative(),
    /** Identidad de la creación (un doble clic no crea dos). */
    clientRequestId: z.string().uuid(),
    /** Cómo se nombra en el Process Center («Colombia · Tecnología»). Sólo texto a la vista. */
    label: z.string().trim().min(1).max(120),
  })
  .strict();

export type BulkSearchCreateInput = z.infer<typeof bulkSearchCreateSchema>;

/** Criterios aceptados: los de una corrida normal, sin la identidad de la corrida. */
export type BulkSearchCriteria = Omit<z.infer<typeof wizardExecutionRequestSchema>, 'clientRequestId'>;

export type BulkCriteriaValidation =
  | { ok: true; criteria: BulkSearchCriteria }
  | { ok: false; message: string };

export function validateBulkCriteria(criteria: Record<string, unknown>, clientRequestId: string): BulkCriteriaValidation {
  if ('clientRequestId' in criteria) return { ok: false, message: 'La identidad de la corrida la pone el servidor.' };
  const parsed = wizardExecutionRequestSchema.safeParse({ ...criteria, clientRequestId });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Criterios inválidos.' };
  const { clientRequestId: _ignored, ...rest } = parsed.data;
  void _ignored;
  if (rest.searchMode && rest.searchMode !== 'exploratory') {
    return { ok: false, message: 'La búsqueda masiva es de «Empresas por criterios».' };
  }
  if (rest.requestedDiscoveryProvider) {
    return { ok: false, message: 'La búsqueda masiva usa el proveedor que decide SellUp.' };
  }
  return { ok: true, criteria: rest };
}

export const bulkSearchControlSchema = z
  .object({ action: z.enum(['pause', 'resume', 'cancel']) })
  .strict();

export type BulkSearchControlAction = z.infer<typeof bulkSearchControlSchema>['action'];

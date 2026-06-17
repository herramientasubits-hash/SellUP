/**
 * wizard-batch-failure.ts — Marks a wizard-reserved batch as failed.
 *
 * Only updates the status column — existing metadata (including client_request_id
 * and wizard context fields) is preserved automatically.
 * Does not create compensatory batches.
 */

export class WizardBatchFailureError extends Error {
  constructor(
    public readonly batchId: string,
    public readonly reason: string,
    public readonly cause?: unknown,
  ) {
    super(`Failed to mark batch ${batchId} as failed (reason: ${reason})`);
    this.name = 'WizardBatchFailureError';
  }
}

/**
 * Injectable function that updates a single batch row.
 * Returns an object with an error field, or null on success.
 */
export type BatchUpdateFn = (
  id: string,
) => Promise<{ error: { message?: string; code?: string } | null }>;

/**
 * Sets the batch status to 'failed' via the injected update function.
 * Throws WizardBatchFailureError if the update fails — callers should catch this
 * to avoid masking the original pipeline error.
 */
export async function markWizardBatchFailed(
  batchId: string,
  reason: 'batchid_mismatch' | 'pipeline_error',
  updateFn: BatchUpdateFn,
): Promise<void> {
  const { error } = await updateFn(batchId);
  if (error) {
    throw new WizardBatchFailureError(batchId, reason, error);
  }
}

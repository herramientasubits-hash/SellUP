'use server';

// qa-harness-server-actions.ts — dedicated top-level 'use server' module for
// Q3F-5AT.2. Client Components may not import inline 'use server' functions
// straight from a plain module (actions.ts), so these two useActionState
// adapters live here instead, following the same split used by
// src/app/(sellup)/settings/providers/provider-detail-actions.ts. Zero
// additional business logic: both delegate immediately to the real
// CREATE_TEST_GRAPH / DELETE_TEST_GRAPH commands in actions.ts.

import { createTestGraph, deleteTestGraph, type QaHarnessResult } from './actions';

export async function createTestGraphActionState(
  _prevState: QaHarnessResult | null, // eslint-disable-line @typescript-eslint/no-unused-vars -- useActionState(action, initialState) signature
  _formData: FormData, // eslint-disable-line @typescript-eslint/no-unused-vars -- useActionState(action, initialState) signature
): Promise<QaHarnessResult> {
  return createTestGraph();
}

export async function deleteTestGraphActionState(
  snapshotId: string,
  _prevState: QaHarnessResult | null, // eslint-disable-line @typescript-eslint/no-unused-vars -- useActionState(action, initialState) signature
  _formData: FormData, // eslint-disable-line @typescript-eslint/no-unused-vars -- useActionState(action, initialState) signature
): Promise<QaHarnessResult> {
  return deleteTestGraph(snapshotId);
}

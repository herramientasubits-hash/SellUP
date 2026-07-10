'use client';

// qa-harness-panel.tsx — TEMPORARY client wiring for Q3F-5AT.2.
//
// Colocated (not folded into actions.ts) because displaying a server
// action's structured return value plainly (section 16/18 requirement)
// needs React state that survives the form submission — a Server Component
// alone cannot hold it. useActionState is the standard mechanism; this file
// exists only to host it. It contains zero business logic: both actions it
// calls (createTestGraphActionState, deleteTestGraphActionState) are thin
// adapters in actions.ts that immediately delegate to the real
// CREATE_TEST_GRAPH / DELETE_TEST_GRAPH commands.

import { useActionState } from 'react';
import { createTestGraphActionState, deleteTestGraphActionState } from './qa-harness-server-actions';
import type { QaHarnessResult } from './actions';

function ResultBlock({ title, state }: { title: string; state: QaHarnessResult | null }) {
  if (!state) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-foreground">
        {JSON.stringify(state, null, 2)}
      </pre>
    </div>
  );
}

export function QaHarnessPanel({ snapshotId }: { snapshotId: string | null }) {
  const [createState, createAction, createPending] = useActionState<QaHarnessResult | null, FormData>(
    createTestGraphActionState,
    null,
  );
  const boundDelete = deleteTestGraphActionState.bind(null, snapshotId ?? '');
  const [deleteState, deleteAction, deletePending] = useActionState<QaHarnessResult | null, FormData>(
    boundDelete,
    null,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <form action={createAction}>
          <button
            type="submit"
            disabled={createPending}
            className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {createPending ? 'Creando…' : 'Create test graph'}
          </button>
        </form>

        {snapshotId ? (
          <form action={deleteAction}>
            <button
              type="submit"
              disabled={deletePending}
              className="inline-flex items-center justify-center rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
            >
              {deletePending ? 'Eliminando…' : 'Delete exact test graph'}
            </button>
          </form>
        ) : null}
      </div>

      <ResultBlock title="CREATE_TEST_GRAPH result" state={createState} />
      <ResultBlock title="DELETE_TEST_GRAPH result" state={deleteState} />
    </div>
  );
}

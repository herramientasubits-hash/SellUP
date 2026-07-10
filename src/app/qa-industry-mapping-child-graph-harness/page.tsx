// page.tsx — TEMPORARY minimal QA page for Q3F-5AT.2. Delete with the rest
// of this directory once live QA validation is complete. Not linked from any
// navigation; the operator opens the exact URL manually.

import { notFound, redirect } from 'next/navigation';
import { readTestState, requireQaHarnessAccess, QaHarnessAccessError } from './actions';
import { IndustryMappingRuntimeBoundaryError } from '@/modules/industry-mapping/mapping-runtime-boundary-types';
import { QaHarnessPanel } from './qa-harness-panel';

export default async function QaIndustryMappingChildGraphHarnessPage() {
  try {
    await requireQaHarnessAccess();
  } catch (err) {
    if (err instanceof QaHarnessAccessError && err.code === 'HARNESS_DISABLED') {
      notFound();
    }
    if (err instanceof QaHarnessAccessError && err.code === 'AUTHENTICATION_REQUIRED') {
      redirect('/login');
    }
    // Any other denial (wrong operator, no internal user, access not
    // active, etc.) — do not reveal QA state or the reason; render as
    // not-found rather than a distinguishable "forbidden" page.
    if (err instanceof QaHarnessAccessError || err instanceof IndustryMappingRuntimeBoundaryError) {
      notFound();
    }
    throw err;
  }

  const state = await readTestState();

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Industry mapping reversible QA</h1>
        <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          Synthetic QA graph. Not Apollo-derived mapping.
        </p>
      </div>

      <div className="rounded-xl border border-border/50 bg-card p-4 text-sm">
        <p className="text-foreground">
          Harness state: <span className="font-medium">enabled</span>
        </p>
        <p className="text-foreground">
          Operator authorization: <span className="font-medium">authorized</span>
        </p>
        <p className="text-foreground">
          Active snapshotId:{' '}
          <span className="font-mono text-xs">{state.snapshotId ?? 'none (NO_ACTIVE_QA_GRAPH)'}</span>
        </p>
        <p className="text-foreground">
          Concept count: <span className="font-medium">{state.conceptCount ?? '—'}</span>
        </p>
        <p className="text-foreground">
          Association count: <span className="font-medium">{state.associationCount ?? '—'}</span>
        </p>
        <p className="mt-2 text-muted-foreground">
          Global counts — source vocabularies: {state.baselineCounts?.sourceVocabularies ?? '—'}, snapshots:{' '}
          {state.baselineCounts?.snapshots ?? '—'}, concepts: {state.baselineCounts?.concepts ?? '—'}, associations:{' '}
          {state.baselineCounts?.associations ?? '—'}
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        Closing this page does not clean up an active test graph. Return to this page to finish deletion.
      </p>

      <QaHarnessPanel snapshotId={state.snapshotId} />

      <div>
        <a
          href="/qa-industry-mapping-child-graph-harness"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Refresh state
        </a>
      </div>

      <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground">READ_TEST_STATE result</p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-foreground">
          {JSON.stringify(state, null, 2)}
        </pre>
      </div>
    </div>
  );
}

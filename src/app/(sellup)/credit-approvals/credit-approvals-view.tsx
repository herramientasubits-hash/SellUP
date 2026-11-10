'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Inbox } from '@/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/forms/field';
import { ListItem, StatusBadge, type StatusType } from '@/components/data-display';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { formatInAppZone } from '@/lib/format-date';
import {
  decideCreditApproval,
  type CreditApprovalRow,
  type CreditApprovalsInbox,
} from '@/modules/credit-approvals/actions';

const formatCredits = (value: number) => Math.round(value).toLocaleString('es-CO');
const formatDate = (iso: string) => formatInAppZone(iso, { dateStyle: 'medium', timeStyle: 'short' }, 'es-CO');

const STATUS: Record<CreditApprovalRow['status'], { status: StatusType; label: string }> = {
  pending: { status: 'pending', label: 'Pendiente' },
  approved: { status: 'completed', label: 'Aprobada' },
  rejected: { status: 'error', label: 'Rechazada' },
  cancelled: { status: 'neutral', label: 'Cancelada' },
};

function outcomeText(row: CreditApprovalRow): string {
  if (row.status === 'approved' && row.approvedCredits !== null) {
    return `${row.decidedByName ?? 'Alguien'} dio ${formatCredits(row.approvedCredits)} créditos para el mes`;
  }
  if (row.status === 'rejected') return `${row.decidedByName ?? 'Alguien'} la rechazó`;
  return 'Esperando a quien aprueba';
}

/** Una solicitud por decidir: cuántos créditos dar, o rechazar. */
function DecisionCard({ row }: { row: CreditApprovalRow }) {
  const router = useRouter();
  const [credits, setCredits] = useState(String(Math.round(row.requestedCredits)));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    setBusy(decision);
    setError(null);
    const result = await decideCreditApproval({ requestId: row.id, decision, credits: Number(credits), note });
    setBusy(null);
    if (!result.success) {
      setError(result.error ?? 'No pudimos guardar la decisión.');
      return;
    }
    router.refresh();
  }

  const amount = Number(credits);
  const canApprove = Number.isInteger(amount) && amount > 0 && busy === null;

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title={`${row.requesterName} pide créditos de ${row.providerLabel}`}
        description={`Llegó al límite de su regla el ${formatDate(row.createdAt)} y pide unos ${formatCredits(row.requestedCredits)} créditos más. Lo que des vale sólo para este mes y sólo para esta persona.`}
        actions={<StatusBadge status="pending" label="Pendiente" />}
      />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,12rem)_1fr]">
        <Field label="Créditos a dar" required>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={credits}
            onChange={(event) => setCredits(event.target.value)}
          />
        </Field>
        <Field label="Nota para la persona (opcional)">
          <Textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="w-full resize-none"
            placeholder="Ej. aprobado para la campaña de cierre"
          />
        </Field>
      </div>
      {error && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => decide('reject')}>
          {busy === 'reject' ? 'Rechazando…' : 'Rechazar'}
        </Button>
        <Button type="button" disabled={!canApprove} onClick={() => decide('approve')}>
          {busy === 'approve' ? 'Aprobando…' : `Dar ${Number.isInteger(amount) && amount > 0 ? formatCredits(amount) : ''} créditos`}
        </Button>
      </div>
    </SurfaceCard>
  );
}

function HistoryList({ title, description, rows, empty }: { title: string; description: string; rows: CreditApprovalRow[]; empty: string }) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader title={title} description={description} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div role="list" className="divide-y divide-border/50">
          {rows.map((row) => (
            <ListItem
              key={row.id}
              role="listitem"
              size="sm"
              className="px-0"
              title={`${row.requesterName} · ${row.providerLabel} · ${formatCredits(row.requestedCredits)} créditos pedidos`}
              description={`${formatDate(row.createdAt)} · ${outcomeText(row)}${row.decisionNote ? ` · «${row.decisionNote}»` : ''}`}
              actions={<StatusBadge status={STATUS[row.status].status} label={STATUS[row.status].label} />}
            />
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}

export function CreditApprovalsView({ inbox }: { inbox: CreditApprovalsInbox }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="to-decide-heading" className="space-y-3">
        <h2 id="to-decide-heading" className="text-base font-semibold text-foreground">
          Por decidir
        </h2>
        {inbox.toDecide.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No tienes solicitudes por decidir"
            description="Cuando alguien de una regla en la que apruebas llegue al límite, su solicitud aparece aquí y te llega un aviso."
          />
        ) : (
          inbox.toDecide.map((row) => <DecisionCard key={row.id} row={row} />)
        )}
      </section>

      <HistoryList
        title="Lo que pediste"
        description="Tus solicitudes de más créditos y qué decidieron."
        rows={inbox.mine}
        empty="Todavía no has pedido créditos."
      />

      {inbox.decidedByMe.length > 0 && (
        <HistoryList
          title="Lo que decidiste"
          description="Las últimas solicitudes que aprobaste o rechazaste."
          rows={inbox.decidedByMe}
          empty=""
        />
      )}
    </div>
  );
}

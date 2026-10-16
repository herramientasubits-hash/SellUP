'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Check, Copy, MessageSquare, PhoneCall, Pencil, Target, ThumbsUp, Trash2 } from '@/icons';
import { formatInAppZone } from '@/lib/format-date';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, type StatusType } from '@/components/data-display';
import { SurfaceCard } from '@/components/shared/surface-card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  discardFirstCallPack,
  markFirstCallPackUsed,
  saveFirstCallScriptEdit,
} from '@/modules/speech/actions';
import {
  FIRST_CALL_CHANNEL_LABELS,
  FIRST_CALL_GOAL_LABELS,
  type FirstCallPack,
  type FirstCallPackStatus,
  type ResearchFact,
} from '@/server/agents/first-call/types';
import { UBITS_PRODUCTS } from '@/server/agents/first-call/ubits-messaging-library';
import { FirstCallLauncher, type FirstCallContactOption } from './first-call-launcher';

const STATUS: Record<FirstCallPackStatus, { status: StatusType; label: string }> = {
  draft: { status: 'info', label: 'Lista para usar' },
  needs_review: { status: 'warning', label: 'Revisar antes de usar' },
  used: { status: 'completed', label: 'Usada' },
  discarded: { status: 'inactive', label: 'Descartada' },
  failed: { status: 'error', label: 'Falló' },
};

function formatDate(iso: string): string {
  return formatInAppZone(iso, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }, 'es-CO');
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('No pudimos copiar. Selecciona el texto y cópialo a mano.');
    }
  };
  return (
    <Button type="button" size="xs" variant="ghost" onClick={copy} aria-label={label}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? 'Copiado' : 'Copiar'}
    </Button>
  );
}

function FactRefs({ refs, facts }: { refs: readonly string[]; facts: ReadonlyMap<string, ResearchFact> }) {
  if (refs.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {refs.map((ref) => {
        const fact = facts.get(ref);
        return (
          <span key={ref} title={fact?.statement}>
            <span className="tabular-nums">{ref}</span>
            {fact ? ` · ${fact.sourceLabel}` : ''}
          </span>
        );
      })}
    </p>
  );
}

function Block({ title, icon: Icon, action, children }: {
  title: string;
  icon?: typeof PhoneCall;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden="true" />}
          {title}
        </h4>
        {action}
      </div>
      {children}
    </section>
  );
}

interface FirstCallPackCardProps {
  pack: FirstCallPack;
  accountId: string;
  contacts: readonly FirstCallContactOption[];
  hasFreshBrief: boolean;
  /** ¿La empresa todavía no está en «Lista para contacto»? */
  canMoveToReady: boolean;
  enabled: boolean;
}

export function FirstCallPackCard({ pack, accountId, contacts, hasFreshBrief, canMoveToReady, enabled }: FirstCallPackCardProps) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(pack.editedScript ?? pack.content?.callScript.text ?? '');
  const [busy, setBusy] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // Los hechos del propio paquete: los de la ficha actual pueden estar numerados distinto.
  const factMap = React.useMemo(() => new Map((pack.facts ?? []).map((f) => [f.id, f])), [pack.facts]);
  const content = pack.content;
  const script = pack.editedScript ?? content?.callScript.text ?? '';
  const closed = pack.status === 'used' || pack.status === 'discarded';

  const run = async (action: () => Promise<{ success: boolean; error?: string }>, ok: string) => {
    setBusy(true);
    try {
      const result = await action();
      if (!result.success) {
        toast.error(result.error ?? 'No pudimos guardar el cambio.');
        return false;
      }
      toast.success(ok);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const markUsed = async (moveToReady: boolean) => {
    setConfirmOpen(false);
    await run(
      () => markFirstCallPackUsed(pack.id, moveToReady),
      moveToReady ? 'Marcada como usada. La empresa pasó a «Lista para contacto».' : 'Marcada como usada.',
    );
  };

  const target = [pack.targetName, pack.targetTitle].filter(Boolean).join(' · ') || 'Sin decisor elegido';

  return (
    <SurfaceCard className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">{target}</p>
          <p className="text-xs text-muted-foreground">
            {FIRST_CALL_CHANNEL_LABELS[pack.channel]} · {FIRST_CALL_GOAL_LABELS[pack.goal]} · {formatDate(pack.createdAt)}
            {pack.regenerationReason ? ` · rehecha: «${pack.regenerationReason}»` : ''}
          </p>
        </div>
        <StatusBadge status={STATUS[pack.status].status} label={STATUS[pack.status].label} />
      </header>

      {pack.status === 'failed' || !content ? (
        <p className="text-sm text-muted-foreground">
          No se pudo escribir esta preparación. Vuelve a intentarlo con «Preparar primera llamada».
        </p>
      ) : (
        <>
          {pack.verifierIssues.length > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-4" aria-hidden="true" />
                Revisa esto antes de usarla
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-6 text-foreground">
                {pack.verifierIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          <Block title="Razón para llamar" icon={Target}>
            <p className="text-sm text-foreground">{content.reasonToCall.text}</p>
            <FactRefs refs={content.reasonToCall.factRefs} facts={factMap} />
            {content.angle && <p className="text-xs text-muted-foreground">Ángulo: {content.angle}</p>}
          </Block>

          <Block
            title="Guion de la llamada"
            icon={PhoneCall}
            action={
              <div className="flex gap-1">
                <CopyButton text={script} label="Copiar el guion" />
                {!closed && (
                  <Button type="button" size="xs" variant="ghost" onClick={() => setEditing((v) => !v)}>
                    <Pencil aria-hidden="true" />
                    {editing ? 'Cerrar' : 'Editar'}
                  </Button>
                )}
              </div>
            }
          >
            {editing ? (
              <div className="space-y-2">
                <Textarea
                  id={`first-call-script-${pack.id}`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={8}
                  aria-label="Tu versión del guion"
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      if (await run(() => saveFirstCallScriptEdit(pack.id, draft), 'Guardamos tu versión del guion.')) setEditing(false);
                    }}
                  >
                    Guardar mi versión
                  </Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-line rounded-xl bg-surface-muted p-3 text-sm leading-relaxed text-foreground">{script}</p>
            )}
            {pack.editedScript && !editing && <p className="text-xs text-muted-foreground">Es tu versión editada.</p>}
            <FactRefs refs={content.callScript.factRefs} facts={factMap} />
          </Block>

          <Block
            title={`Mensaje corto · ${FIRST_CALL_CHANNEL_LABELS[pack.channel]}`}
            icon={MessageSquare}
            action={<CopyButton text={content.shortMessage.text} label="Copiar el mensaje corto" />}
          >
            <p className="whitespace-pre-line rounded-xl bg-surface-muted p-3 text-sm leading-relaxed text-foreground">
              {content.shortMessage.text}
            </p>
          </Block>

          <div className="grid gap-5 lg:grid-cols-2">
            <Block title="Preguntas para descubrir">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
                {content.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </Block>
            <Block title="Si te dicen…">
              <ul className="space-y-2 text-sm">
                {content.objections.map((o) => (
                  <li key={o.objection}>
                    <p className="font-medium text-foreground">«{o.objection}»</p>
                    <p className="text-muted-foreground">{o.response}</p>
                  </li>
                ))}
              </ul>
            </Block>
          </div>

          <Block title="Siguiente paso">
            <p className="text-sm text-foreground">{content.nextStep}</p>
          </Block>

          {content.cautions.length > 0 && (
            <Block title="Cuidado" icon={AlertTriangle}>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {content.cautions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </Block>
          )}
        </>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
        <div className="flex flex-wrap gap-1">
          {pack.productFocus && (
            <Badge variant="outline">{UBITS_PRODUCTS.find((p) => p.key === pack.productFocus)?.name ?? pack.productFocus}</Badge>
          )}
        </div>
        {enabled && !closed && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => run(() => discardFirstCallPack(pack.id), 'Descartada.')}>
              <Trash2 aria-hidden="true" />
              Descartar
            </Button>
            <FirstCallLauncher
              accountId={accountId}
              contacts={contacts}
              hasFreshBrief={hasFreshBrief}
              variant="outline"
              regenerate={{
                packId: pack.id,
                contactId: pack.contactId,
                channel: pack.channel,
                goal: pack.goal,
                productFocus: pack.productFocus,
              }}
            />
            {content && (
              <Button type="button" size="sm" disabled={busy} onClick={() => (canMoveToReady ? setConfirmOpen(true) : markUsed(false))}>
                <ThumbsUp aria-hidden="true" />
                La usé
              </Button>
            )}
          </div>
        )}
      </footer>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Pasar la empresa a «Lista para contacto»?"
        description="Marcamos esta preparación como usada. Si ya vas a contactarla, también puedes mover la empresa de etapa en el Pipeline."
        confirmLabel="Sí, pasarla"
        secondaryLabel="Sólo marcar como usada"
        secondaryVariant="outline"
        cancelLabel="Cancelar"
        onConfirm={() => markUsed(true)}
        onSecondary={() => markUsed(false)}
        loading={busy}
      />
    </SurfaceCard>
  );
}

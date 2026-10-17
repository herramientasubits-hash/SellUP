'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Check, ChevronDown, Copy, MessageSquare, PhoneCall, Pencil, Target, ThumbsUp, Trash2 } from '@/icons';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  goalsLabel,
  type FirstCallChannel,
  type FirstCallPack,
  type FirstCallPackStatus,
  type ResearchFact,
} from '@/server/agents/first-call/types';
import { ubitsProductNames } from '@/server/agents/first-call/ubits-messaging-library';
import { FirstCallLauncher, type FirstCallContactOption, type FirstContactLaunchRequest } from './first-call-launcher';

const STATUS: Record<FirstCallPackStatus, { status: StatusType; label: string }> = {
  draft: { status: 'info', label: 'Lista para usar' },
  needs_review: { status: 'warning', label: 'Revisar antes de usar' },
  used: { status: 'completed', label: 'Usada' },
  discarded: { status: 'inactive', label: 'Descartada' },
  failed: { status: 'error', label: 'Falló' },
};

/** El texto que acompaña al guion (o lo reemplaza) según el canal. */
const MESSAGE_TITLE: Record<FirstCallChannel, string> = {
  call: 'Si no contesta',
  whatsapp: 'Mensaje de WhatsApp',
  email: 'Correo',
  linkedin: 'Nota de LinkedIn',
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
  accountName?: string;
  /** Dentro del panel lateral de la empresa: el agente lo abre quien monta el panel. */
  onRequestFirstContact?: (request: FirstContactLaunchRequest) => void;
  /** Dentro del grupo de un decisor: no repite su nombre. */
  grouped?: boolean;
  contacts: readonly FirstCallContactOption[];
  hasFreshBrief: boolean;
  /** ¿La empresa todavía no está en «Lista para contacto»? */
  canMoveToReady: boolean;
  enabled: boolean;
  /** Tras un cambio. Sin él se refresca la ruta (página completa de la empresa). */
  onChanged?: () => void;
}

export function FirstCallPackCard({
  pack,
  accountId,
  accountName,
  onRequestFirstContact,
  grouped = false,
  contacts,
  hasFreshBrief,
  canMoveToReady,
  enabled,
  onChanged,
}: FirstCallPackCardProps) {
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
      if (onChanged) onChanged();
      else router.refresh();
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
  const products = ubitsProductNames(pack.productFocus);
  const isCall = pack.channel === 'call';

  return (
    <SurfaceCard className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">{grouped ? FIRST_CALL_CHANNEL_LABELS[pack.channel] : target}</p>
          <p className="text-xs text-muted-foreground">
            {grouped ? '' : `${FIRST_CALL_CHANNEL_LABELS[pack.channel]} · `}
            {goalsLabel(pack.goals)} · {formatDate(pack.createdAt)}
            {pack.regenerationReason ? ` · otra versión: «${pack.regenerationReason}»` : ''}
          </p>
        </div>
        <StatusBadge status={STATUS[pack.status].status} label={STATUS[pack.status].label} />
      </header>

      {pack.status === 'failed' || !content ? (
        <p className="text-sm text-muted-foreground">
          No se pudo escribir esta preparación. Vuelve a intentarlo con «Preparar primer contacto».
        </p>
      ) : (
        <>
          {pack.verifierIssues.length > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Revisa esto antes de usarla
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-foreground">
                {pack.verifierIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          <section aria-label="Por qué contactarlo hoy" className="rounded-xl border border-primary/20 bg-primary/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Target className="size-3.5" aria-hidden="true" />
              Por qué contactarlo hoy
            </p>
            <p className="mt-1 text-sm text-foreground">{content.reasonToCall.text}</p>
            <FactRefs refs={content.reasonToCall.factRefs} facts={factMap} />
            {content.angle && <p className="mt-1.5 text-xs text-muted-foreground">Enfoque: {content.angle}</p>}
          </section>

          {isCall && script && (
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
            </Block>
          )}

          <Block
            title={MESSAGE_TITLE[pack.channel]}
            icon={MessageSquare}
            action={<CopyButton text={content.shortMessage.text} label={`Copiar: ${MESSAGE_TITLE[pack.channel].toLowerCase()}`} />}
          >
            <p
              className={cn(
                'whitespace-pre-line rounded-xl bg-surface-muted p-3 leading-relaxed text-foreground',
                isCall ? 'text-xs' : 'text-sm',
              )}
            >
              {content.shortMessage.text}
            </p>
          </Block>

          {/* Lo que sirve DURANTE la conversación: en pestañas, para no hacer un muro de texto. */}
          <Tabs defaultValue="preguntas" className="gap-3">
            <TabsList variant="line" aria-label="Para la conversación">
              <TabsTrigger value="preguntas">Preguntas · {content.questions.length}</TabsTrigger>
              <TabsTrigger value="objeciones">Si te dicen… · {content.objections.length}</TabsTrigger>
              <TabsTrigger value="siguiente">Siguiente paso</TabsTrigger>
              {content.cautions.length > 0 && <TabsTrigger value="cuidado">Cuidado · {content.cautions.length}</TabsTrigger>}
            </TabsList>
            <TabsContent value="preguntas">
              <ol className="space-y-2">
                {content.questions.map((q, i) => (
                  <li key={q} className="flex gap-2.5 text-sm text-foreground">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <span>{q}</span>
                  </li>
                ))}
              </ol>
            </TabsContent>
            <TabsContent value="objeciones">
              <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
                {content.objections.map((o) => (
                  <li key={o.objection}>
                    <details className="group/objection">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
                        «{o.objection}»
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open/objection:rotate-180" aria-hidden="true" />
                      </summary>
                      <p className="px-3 pb-3 text-sm leading-relaxed text-muted-foreground">{o.response}</p>
                    </details>
                  </li>
                ))}
              </ul>
            </TabsContent>
            <TabsContent value="siguiente">
              <p className="text-sm leading-relaxed text-foreground">{content.nextStep}</p>
            </TabsContent>
            {content.cautions.length > 0 && (
              <TabsContent value="cuidado">
                <ul className="space-y-1.5">
                  {content.cautions.map((c) => (
                    <li key={c} className="flex gap-2 text-sm text-muted-foreground">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
                      {c}
                    </li>
                  ))}
                </ul>
              </TabsContent>
            )}
          </Tabs>
        </>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
        <div className="flex flex-wrap gap-1">
          {products.map((name) => (
            <Badge key={name} variant="outline">
              {name}
            </Badge>
          ))}
        </div>
        {enabled && !closed && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => run(() => discardFirstCallPack(pack.id), 'Descartada.')}>
              <Trash2 aria-hidden="true" />
              Descartar
            </Button>
            <FirstCallLauncher
              accountId={accountId}
              accountName={accountName}
              contacts={contacts}
              hasFreshBrief={hasFreshBrief}
              variant="outline"
              onDone={onChanged}
              onRequestOpen={onRequestFirstContact}
              regenerate={{
                packId: pack.id,
                contactId: pack.contactId,
                channel: pack.channel,
                goal: pack.goal,
                goals: pack.goals,
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

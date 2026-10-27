'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Check, ChevronDown, Clock, Copy, MessageSquare, PhoneCall, Pencil, Target, ThumbsUp, Trash2 } from '@/icons';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatInAppZone } from '@/lib/format-date';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { StatusBadge, type StatusType } from '@/components/data-display';
import { SurfaceCard } from '@/components/shared/surface-card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  discardFirstCallPack,
  markFirstCallPackUsed,
  saveFirstCallScriptEdit,
  setFirstCallPackOutcome,
} from '@/modules/speech/actions';
import {
  APPROACH_DEFINITIONS,
  FIRST_CONTACT_OUTCOMES,
  FIRST_CONTACT_OUTCOME_LABELS,
  bestContactWindow,
  type FirstContactOutcome,
} from '@/server/agents/first-call/approaches';
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
import { MAIN_VERSION, MessageTypeSelect, messageTypeOptions } from './message-type-select';
import { LanguageSwitch, type PackLanguage } from './language-switch';
import { localizedContent } from '@/server/agents/first-call/pack-translation';

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
  /** País de la empresa: para sugerir cuándo contactar en su hora. */
  countryCode?: string | null;
}

const OUTCOME_STATUS: Record<FirstContactOutcome, StatusType> = {
  meeting_booked: 'completed',
  interested: 'info',
  not_now: 'warning',
  wrong_person: 'inactive',
  no_answer: 'inactive',
};

/** «La usé» o «Cambiar resultado»: el vendedor dice qué pasó con el contacto. */
function OutcomeMenu({
  label,
  disabled,
  onPick,
  variant = 'default',
}: {
  label: string;
  disabled: boolean;
  onPick: (outcome: FirstContactOutcome) => void;
  variant?: 'default' | 'outline';
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" size="sm" variant={variant} disabled={disabled}>
            <ThumbsUp aria-hidden="true" />
            {label}
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {FIRST_CONTACT_OUTCOMES.map((outcome) => (
          <DropdownMenuItem key={outcome} onClick={() => onPick(outcome)}>
            {FIRST_CONTACT_OUTCOME_LABELS[outcome]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  countryCode = null,
}: FirstCallPackCardProps) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(pack.editedScript ?? pack.content?.callScript.text ?? '');
  const [busy, setBusy] = React.useState(false);
  // La versión que se muestra: la principal o la de otro enfoque.
  // Usada: se abre en la versión que se usó.
  const [version, setVersion] = React.useState<string>(() =>
    pack.outcome?.approach && pack.content?.variants?.some((v) => v.approach === pack.outcome?.approach) ? pack.outcome.approach : MAIN_VERSION,
  );
  // Los hechos del propio paquete: los de la ficha actual pueden estar numerados distinto.
  const factMap = React.useMemo(() => new Map((pack.facts ?? []).map((f) => [f.id, f])), [pack.facts]);
  // Brasil y EE. UU.: lo que se dice o se envía también en el idioma del país.
  const [language, setLanguage] = React.useState<PackLanguage>('es');
  const localLanguage = pack.content?.localVersion?.language ?? null;
  const inLocal = language === 'local' && !!localLanguage;
  const content = pack.content && inLocal ? localizedContent(pack.content) : pack.content;
  // Tu versión editada del guion es en español.
  const script = (inLocal ? null : pack.editedScript) ?? content?.callScript.text ?? '';
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

  const markUsed = async (outcome: FirstContactOutcome) => {
    // La versión que tenía a la vista al marcarla: la principal o la de otro enfoque.
    const usedApproach = pack.content?.variants?.find((v) => v.approach === version)?.approach ?? pack.content?.approach ?? null;
    await run(
      () => markFirstCallPackUsed(pack.id, canMoveToReady, outcome, usedApproach),
      `Marcada como usada: ${FIRST_CONTACT_OUTCOME_LABELS[outcome].toLowerCase()}.`,
    );
  };

  const target = [pack.targetName, pack.targetTitle].filter(Boolean).join(' · ') || 'Sin decisor elegido';
  const products = ubitsProductNames(pack.productFocus);
  const isCall = pack.channel === 'call';
  const variants = content?.variants ?? [];
  const mainApproach = content?.approach ?? null;
  const shownVariant = variants.find((v) => v.approach === version) ?? null;
  // Cada tipo cambia TODO: en la llamada, el guion completo y el mensaje si no contesta.
  // Las preparaciones viejas sólo traían la apertura (sin mensaje de voz): se muestra aparte.
  const openerOnly = isCall && !!shownVariant && !shownVariant.voicemail;
  const shownScript = isCall && shownVariant && !openerOnly ? shownVariant.text : script;
  const canEditScript = !closed && !shownVariant && !inLocal;
  const message = shownVariant
    ? isCall
      ? shownVariant.voicemail ?? content?.shortMessage.text ?? ''
      : shownVariant.text
    : content?.shortMessage.text ?? '';

  return (
    <SurfaceCard className="space-y-4">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-base font-semibold text-foreground">{grouped ? FIRST_CALL_CHANNEL_LABELS[pack.channel] : target}</p>
            <p className="text-xs text-muted-foreground">
              {grouped ? '' : `${FIRST_CALL_CHANNEL_LABELS[pack.channel]} · `}
              {goalsLabel(pack.goals)} · {formatDate(pack.createdAt)}
              {pack.regenerationReason ? ` · otra versión: «${pack.regenerationReason}»` : ''}
            </p>
          </div>
          {pack.outcome ? (
            <StatusBadge status={OUTCOME_STATUS[pack.outcome.result]} label={FIRST_CONTACT_OUTCOME_LABELS[pack.outcome.result]} />
          ) : (
            <StatusBadge status={STATUS[pack.status].status} label={STATUS[pack.status].label} />
          )}
        </div>
        {content && pack.status !== 'failed' && (
          <div className="space-y-2 rounded-xl border border-border/60 bg-surface-subtle p-3">
            <MessageTypeSelect
              options={messageTypeOptions(mainApproach, variants)}
              value={version}
              onValueChange={setVersion}
              isCall={isCall}
            />
            {localLanguage && <LanguageSwitch language={localLanguage} value={language} onValueChange={setLanguage} />}
            {pack.status !== 'used' && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {bestContactWindow(countryCode, pack.channel)}
              </p>
            )}
          </div>
        )}
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
            {content.angle && <p className="mt-1.5 text-xs text-muted-foreground">Ángulo: {content.angle}</p>}
            {content.approachReason && mainApproach && version === MAIN_VERSION && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {APPROACH_DEFINITIONS[mainApproach].label}: {content.approachReason}
              </p>
            )}
          </section>

          {openerOnly && shownVariant && (
            <Block title={`Apertura · ${APPROACH_DEFINITIONS[shownVariant.approach].label}`} icon={PhoneCall} action={<CopyButton text={shownVariant.text} label="Copiar la apertura" />}>
              <p className="whitespace-pre-line rounded-xl bg-primary/5 p-3 text-sm leading-relaxed text-foreground">{shownVariant.text}</p>
              <p className="text-xs text-muted-foreground">Después de la apertura, sigue con el guion desde el motivo.</p>
            </Block>
          )}

          {isCall && shownScript && (
            <Block
              title="Guion de la llamada"
              icon={PhoneCall}
              action={
                <div className="flex gap-1">
                  <CopyButton text={shownScript} label="Copiar el guion" />
                  {canEditScript && (
                    <Button type="button" size="xs" variant="ghost" onClick={() => setEditing((v) => !v)}>
                      <Pencil aria-hidden="true" />
                      {editing ? 'Cerrar' : 'Editar'}
                    </Button>
                  )}
                </div>
              }
            >
              {editing && canEditScript ? (
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
                <p className="whitespace-pre-line rounded-xl bg-surface-muted p-3 text-sm leading-relaxed text-foreground">{shownScript}</p>
              )}
              {pack.editedScript && !editing && !shownVariant && !inLocal && <p className="text-xs text-muted-foreground">Es tu versión editada.</p>}
            </Block>
          )}

          <Block
            title={MESSAGE_TITLE[pack.channel]}
            icon={MessageSquare}
            action={<CopyButton text={message} label={`Copiar: ${MESSAGE_TITLE[pack.channel].toLowerCase()}`} />}
          >
            <p
              className={cn(
                'whitespace-pre-line rounded-xl bg-surface-muted p-3 leading-relaxed text-foreground',
                isCall ? 'text-xs' : 'text-sm',
              )}
            >
              {message}
            </p>
          </Block>

          {/* Lo que sirve DURANTE la conversación: en pestañas, para no hacer un muro de texto. */}
          <Tabs defaultValue={content.meetingAsk ? 'reunion' : 'preguntas'} className="gap-3">
            <TabsList variant="line" aria-label="Para la conversación">
              {content.meetingAsk && <TabsTrigger value="reunion">Pedir la reunión</TabsTrigger>}
              <TabsTrigger value="preguntas">Preguntas · {content.questions.length}</TabsTrigger>
              <TabsTrigger value="objeciones">Si te dicen… · {content.objections.length}</TabsTrigger>
              {content.confirmation ? (
                <TabsTrigger value="confirmar">Después de agendar</TabsTrigger>
              ) : (
                <TabsTrigger value="siguiente">Siguiente paso</TabsTrigger>
              )}
              {content.cautions.length > 0 && <TabsTrigger value="cuidado">Cuidado · {content.cautions.length}</TabsTrigger>}
            </TabsList>
            {content.meetingAsk && (
              <TabsContent value="reunion" className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="whitespace-pre-line rounded-xl bg-surface-muted p-3 text-sm leading-relaxed text-foreground">{content.meetingAsk}</p>
                  <CopyButton text={content.meetingAsk} label="Copiar cómo pedir la reunión" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Pídela al ver interés, con dos horarios concretos, y si es por teléfono envía la invitación en la llamada. {content.nextStep}
                </p>
              </TabsContent>
            )}
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
                    <Collapsible>
                      <CollapsibleTrigger className="group/objection flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                        «{o.objection}»
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-data-[panel-open]/objection:rotate-180" aria-hidden="true" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <p className="px-3 pb-3 text-sm leading-relaxed text-muted-foreground">{o.response}</p>
                      </CollapsibleContent>
                    </Collapsible>
                  </li>
                ))}
              </ul>
              {content.ifNo && (
                <div className="mt-3 rounded-xl border border-warning/30 bg-warning/5 p-3">
                  <p className="text-xs font-medium text-warning">Si dice que no o «no es momento»</p>
                  <p className="mt-1 text-sm leading-relaxed text-foreground">{content.ifNo}</p>
                </div>
              )}
            </TabsContent>
            {content.confirmation ? (
              <TabsContent value="confirmar" className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="whitespace-pre-line rounded-xl bg-surface-muted p-3 text-sm leading-relaxed text-foreground">{content.confirmation}</p>
                  <CopyButton text={content.confirmation} label="Copiar la confirmación" />
                </div>
                <p className="text-xs text-muted-foreground">Envíala apenas agendes. Un recordatorio el día antes y otro una hora antes bajan las ausencias.</p>
              </TabsContent>
            ) : (
              <TabsContent value="siguiente">
                <p className="text-sm leading-relaxed text-foreground">{content.nextStep}</p>
              </TabsContent>
            )}
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
                approach: mainApproach,
              }}
            />
            {content && <OutcomeMenu label="La usé" disabled={busy} onPick={(outcome) => void markUsed(outcome)} />}
          </div>
        )}
        {enabled && pack.status === 'used' && (
          <OutcomeMenu
            label={pack.outcome ? 'Cambiar resultado' : '¿Qué pasó?'}
            variant="outline"
            disabled={busy}
            onPick={(outcome) =>
              void run(() => setFirstCallPackOutcome(pack.id, outcome), `Resultado: ${FIRST_CONTACT_OUTCOME_LABELS[outcome].toLowerCase()}.`)
            }
          />
        )}
      </footer>
    </SurfaceCard>
  );
}

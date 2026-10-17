'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Loader2, PhoneCall, RefreshCw } from '@/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { DrawerSection } from '@/components/shared/drawer-section';
import { Field } from '@/components/forms/field';
import { cn } from '@/lib/utils';
import { getFirstCallProgress } from '@/modules/speech/actions';
import {
  FIRST_CALL_CHANNELS,
  FIRST_CALL_CHANNEL_LABELS,
  FIRST_CALL_GOALS,
  FIRST_CALL_GOAL_LABELS,
  RESEARCH_PROGRESS_LABELS,
  type FirstCallChannel,
  type FirstCallGoal,
  type ResearchProgressStage,
} from '@/server/agents/first-call/types';
import { UBITS_PRODUCTS } from '@/server/agents/first-call/ubits-messaging-library';

import type { FirstCallContactOption } from '@/modules/speech/first-call-contacts';

export type { FirstCallContactOption };

export interface FirstCallRegenerateSeed {
  packId: string;
  contactId: string | null;
  channel: FirstCallChannel;
  goal: FirstCallGoal;
  productFocus: string | null;
}

interface FirstCallLauncherProps {
  accountId: string;
  contacts: readonly FirstCallContactOption[];
  /** ¿Hay una ficha vigente? Entonces se ofrece «investigar de nuevo». */
  hasFreshBrief: boolean;
  defaultContactId?: string | null;
  /** Rehacer un paquete: el formulario llega con sus datos y pide el motivo. */
  regenerate?: FirstCallRegenerateSeed;
  label?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'default';
  /**
   * Al terminar. Sin él, va a la pestaña «Primera llamada» de la página de la
   * empresa; con él (el panel lateral), quien llama recarga sus datos.
   */
  onDone?: () => void;
  /** Modo controlado: quien lo monta decide cuándo se abre (sin botón propio con `hideTrigger`). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}

const NO_CONTACT = 'none';
const ANY_PRODUCT = 'any';
/** Cada cuánto se mira el avance mientras investiga. */
const PROGRESS_POLL_MS = 2_500;

const STAGES_WITH_RESEARCH: readonly ResearchProgressStage[] = [
  'reading_sellup',
  'reading_site',
  'reading_news',
  'extracting',
  'writing',
];
const STAGES_REUSING_BRIEF: readonly ResearchProgressStage[] = ['writing'];

type RunResponse =
  | { ok: true; packStatus: string; reusedBrief: boolean }
  | { ok: false; code: string; message: string };

function ProgressList({ stages, current }: { stages: readonly ResearchProgressStage[]; current: ResearchProgressStage | null }) {
  const currentIndex = current ? stages.indexOf(current) : 0;
  return (
    <ol className="space-y-2" aria-live="polite">
      {stages.map((stage, i) => {
        const done = currentIndex > i;
        const active = currentIndex === i || (currentIndex === -1 && i === 0);
        return (
          <li key={stage} className="flex items-center gap-2 text-sm">
            {done ? (
              <Check className="size-4 text-success" aria-hidden="true" />
            ) : active ? (
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
            ) : (
              <span className="size-4 rounded-full border border-border" aria-hidden="true" />
            )}
            <span className={cn(done ? 'text-muted-foreground' : active ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {RESEARCH_PROGRESS_LABELS[stage]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function FirstCallLauncher({
  accountId,
  contacts,
  hasFreshBrief,
  defaultContactId = null,
  regenerate,
  label,
  variant = 'default',
  size = 'sm',
  onDone,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: FirstCallLauncherProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = React.useCallback(
    (next: boolean) => {
      setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const [contactId, setContactId] = React.useState<string>(regenerate?.contactId ?? defaultContactId ?? contacts[0]?.id ?? NO_CONTACT);
  const [channel, setChannel] = React.useState<FirstCallChannel>(regenerate?.channel ?? 'call');
  const [goal, setGoal] = React.useState<FirstCallGoal>(regenerate?.goal ?? 'book_meeting');
  const [product, setProduct] = React.useState<string>(regenerate?.productFocus ?? ANY_PRODUCT);
  const [refresh, setRefresh] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [stage, setStage] = React.useState<ResearchProgressStage | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const willResearch = !hasFreshBrief || refresh;
  const stages = willResearch ? STAGES_WITH_RESEARCH : STAGES_REUSING_BRIEF;
  const selectedContact = contacts.find((c) => c.id === contactId) ?? null;
  const productName = UBITS_PRODUCTS.find((p) => p.key === product)?.name ?? 'El que mejor conecte';

  React.useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const current = await getFirstCallProgress(accountId);
        if (!cancelled && current) setStage(current);
      } catch {
        // El avance es cosmético: si una lectura falla, la siguiente lo intenta.
      }
    }, PROGRESS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [running, accountId]);

  const submit = async () => {
    setRunning(true);
    setError(null);
    setStage(stages[0]);
    try {
      const response = await fetch('/api/agent3/first-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          contactId: contactId === NO_CONTACT ? null : contactId,
          channel,
          goal,
          productFocus: product === ANY_PRODUCT ? null : product,
          refreshResearch: refresh,
          regenerateFromPackId: regenerate?.packId ?? null,
          regenerationReason: regenerate ? reason.trim() || null : null,
        }),
      });
      // Sin sesión, el proxy redirige a /login y la respuesta es la página, no JSON.
      if (response.redirected && new URL(response.url).pathname.startsWith('/login')) {
        setError('Tu sesión se cerró. Vuelve a iniciar sesión e inténtalo de nuevo.');
        return;
      }
      const result = (await response.json().catch(() => null)) as RunResponse | null;
      if (!result || !result.ok) {
        setError(result && !result.ok ? result.message : 'Algo falló al preparar la llamada. Vuelve a intentarlo.');
        return;
      }
      toast.success(
        result.packStatus === 'needs_review'
          ? 'Lista, con avisos para revisar antes de usarla.'
          : 'La preparación de la llamada está lista.',
      );
      setOpen(false);
      setReason('');
      if (onDone) {
        onDone();
      } else {
        router.push(`/accounts/${accountId}?tab=primera-llamada`);
        router.refresh();
      }
    } catch {
      setError('No pudimos conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.');
    } finally {
      setRunning(false);
      setStage(null);
    }
  };

  const triggerLabel = label ?? (regenerate ? 'Rehacer' : 'Preparar primera llamada');

  return (
    <>
      {!hideTrigger && (
        <Button type="button" size={size} variant={variant} onClick={() => setOpen(true)}>
          {regenerate ? <RefreshCw aria-hidden="true" /> : <PhoneCall aria-hidden="true" />}
          {triggerLabel}
        </Button>
      )}
      <DrawerShell
        open={open}
        onOpenChange={(next) => {
          if (!running) setOpen(next);
        }}
        size="md"
        icon={<PhoneCall className="size-5" aria-hidden="true" />}
        title={regenerate ? 'Rehacer la preparación' : 'Preparar primera llamada'}
        description={
          willResearch
            ? 'El agente investiga la empresa (sitio oficial, noticias del último año y lo que ya sabe SellUp) y escribe qué decir. Tarda entre 1 y 2 minutos.'
            : 'Usa la investigación vigente de la empresa y escribe qué decir. Tarda unos segundos.'
        }
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={running}>
              Cancelar
            </Button>
            <Button type="button" onClick={submit} disabled={running || (!!regenerate && reason.trim().length === 0)}>
              {running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <PhoneCall aria-hidden="true" />}
              {running ? 'Preparando…' : regenerate ? 'Rehacer' : 'Preparar'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {running ? (
            <DrawerSection title="Trabajando" hint="Puedes dejar esta ventana abierta; no cierres la página.">
              <ProgressList stages={stages} current={stage} />
            </DrawerSection>
          ) : (
            <DrawerSection title="A quién y cómo" hint="El guion cambia según el cargo, el canal y lo que buscas.">
              <div className="space-y-4">
                <Field label="Decisor" description={contacts.length === 0 ? 'Esta empresa todavía no tiene contactos: el guion pedirá averiguar quién decide.' : undefined}>
                  <Select value={contactId} onValueChange={(v) => setContactId(v ?? NO_CONTACT)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {selectedContact
                          ? `${selectedContact.name}${selectedContact.title ? ` · ${selectedContact.title}` : ''}`
                          : 'Sin decisor elegido'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {contacts.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {c.title ? ` · ${c.title}` : ''}
                        </SelectItem>
                      ))}
                      <SelectItem value={NO_CONTACT}>Sin decisor elegido</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Canal">
                  <Select value={channel} onValueChange={(v) => v && setChannel(v as FirstCallChannel)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{FIRST_CALL_CHANNEL_LABELS[channel]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {FIRST_CALL_CHANNELS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {FIRST_CALL_CHANNEL_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Objetivo">
                  <Select value={goal} onValueChange={(v) => v && setGoal(v as FirstCallGoal)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{FIRST_CALL_GOAL_LABELS[goal]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {FIRST_CALL_GOALS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {FIRST_CALL_GOAL_LABELS[g]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Producto de UBITS" description="Opcional. Si no eliges, el agente usa el que mejor conecte con lo que encuentre.">
                  <Select value={product} onValueChange={(v) => setProduct(v ?? ANY_PRODUCT)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{productName}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY_PRODUCT}>El que mejor conecte</SelectItem>
                      {UBITS_PRODUCTS.map((p) => (
                        <SelectItem key={p.key} value={p.key}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {hasFreshBrief && (
                  <div className="flex items-start gap-2">
                    <Checkbox id="first-call-refresh" checked={refresh} onCheckedChange={(v) => setRefresh(v === true)} />
                    <Label htmlFor="first-call-refresh" className="text-sm font-normal leading-snug">
                      Investigar de nuevo la empresa (la investigación actual sigue vigente; rehacerla tiene costo)
                    </Label>
                  </div>
                )}
                {regenerate && (
                  <Field label="¿Qué cambiarías?" required description="Lo lee el agente: «más corto», «más ejecutivo», «no menciones X»…">
                    <Textarea
                      id="first-call-regenerate-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={300}
                      rows={3}
                    />
                  </Field>
                )}
              </div>
            </DrawerSection>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </DrawerShell>
    </>
  );
}

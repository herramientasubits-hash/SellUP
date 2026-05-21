'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, Globe, Target, Zap, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { generateAIProspectBatch } from '@/modules/prospect-batches/actions';
import {
  LATAM_COUNTRIES,
  INDUSTRIES,
  BATCH_SEARCH_DEPTH_LABELS,
  type BatchSearchDepth,
} from '@/modules/prospect-batches/types';
import { Section, Field, Row, getFlagEmoji } from '@/components/accounts/account-form-helpers';

const MVP_MAX_CANDIDATES = 25;

const EMPTY = {
  countryCode: '',
  industry: '',
  targetCount: String(MVP_MAX_CANDIDATES),
  searchDepth: 'standard' as BatchSearchDepth,
};

export function GenerateAIBatchDrawer() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ ...EMPTY });
  const [generating, setGenerating] = React.useState(false);
  const [progressMsg, setProgressMsg] = React.useState('');

  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleClose() {
    if (generating) return;
    setOpen(false);
    setForm({ ...EMPTY });
    setProgressMsg('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.countryCode) {
      toast.error('Selecciona un país');
      return;
    }
    if (!form.industry) {
      toast.error('Selecciona una industria');
      return;
    }

    const count = parseInt(form.targetCount) || MVP_MAX_CANDIDATES;

    setGenerating(true);
    setProgressMsg('Iniciando agente…');

    try {
      const country = LATAM_COUNTRIES.find((c) => c.code === form.countryCode);

      setProgressMsg('Consultando Apollo para descubrir empresas…');

      const result = await generateAIProspectBatch({
        country: country?.name ?? form.countryCode,
        countryCode: form.countryCode,
        industry: form.industry,
        targetCount: count,
        searchDepth: form.searchDepth as 'basic' | 'standard',
      });

      toast.success(
        `Lote generado con ${result.candidatesCreated} empresa${result.candidatesCreated !== 1 ? 's' : ''} candidata${result.candidatesCreated !== 1 ? 's' : ''}`,
        { description: 'Listo para revisión humana.' }
      );

      setOpen(false);
      setForm({ ...EMPTY });
      setProgressMsg('');
      router.push(`/prospect-batches/${result.batchId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al generar el lote');
      setProgressMsg('');
    } finally {
      setGenerating(false);
    }
  }

  const canSubmit = !!form.countryCode && !!form.industry && !generating;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        className="gap-1.5 bg-su-brand text-white hover:bg-su-brand/90"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Generar con IA
      </Button>

      <Sheet open={open} onOpenChange={(v) => !v && handleClose()}>
        <SheetContent className="flex flex-col gap-0 overflow-hidden sm:w-[40vw] sm:min-w-[520px] sm:max-w-none">
          {/* Header */}
          <SheetHeader className="shrink-0 border-b border-border/50 px-7 pb-5 pt-6">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-su-brand-soft">
                <Sparkles className="h-4 w-4 text-su-brand" />
              </div>
              <div className="space-y-0.5">
                <SheetTitle className="text-base font-semibold">
                  Generar empresas candidatas con IA
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground/70">
                  El agente consulta Apollo para descubrir empresas y usa HubSpot para detectar duplicados.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {/* Body */}
          <form
            id="generate-ai-batch-form"
            onSubmit={handleSubmit}
            className="flex-1 space-y-8 overflow-y-auto px-7 py-6"
          >
            {/* Segmentación */}
            <Section icon={Globe} label="Segmentación">
              <Row>
                <Field label="País" required>
                  <Select
                    value={form.countryCode}
                    onValueChange={(v) => set('countryCode', v ?? '')}
                    disabled={generating}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccionar país" />
                    </SelectTrigger>
                    <SelectContent>
                      {LATAM_COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {getFlagEmoji(c.code)} {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Industria" required>
                  <Select
                    value={form.industry}
                    onValueChange={(v) => set('industry', v ?? '')}
                    disabled={generating}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccionar industria" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDUSTRIES.map((ind) => (
                        <SelectItem key={ind} value={ind}>
                          {ind}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </Row>
            </Section>

            {/* Parámetros */}
            <Section icon={Target} label="Parámetros">
              <Row>
                <Field label="Cantidad objetivo">
                  <Select
                    value={form.targetCount}
                    onValueChange={(v) => set('targetCount', v ?? String(MVP_MAX_CANDIDATES))}
                    disabled={generating}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[5, 10, 15, 20, 25].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} empresas
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Profundidad">
                  <Select
                    value={form.searchDepth}
                    onValueChange={(v) => set('searchDepth', (v ?? 'standard') as BatchSearchDepth)}
                    disabled={generating}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['basic', 'standard'] as BatchSearchDepth[]).map((key) => (
                        <SelectItem key={key} value={key}>
                          {BATCH_SEARCH_DEPTH_LABELS[key]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </Row>
            </Section>

            {/* Info note */}
            <div className="rounded-xl border border-border/40 bg-muted/40 px-4 py-3">
              <div className="flex gap-2.5">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <p className="text-xs text-muted-foreground">
                  El MVP permite máximo {MVP_MAX_CANDIDATES} empresas candidatas por lote para controlar calidad y costos.
                  Ninguna empresa se crea automáticamente — toda candidata requiere revisión humana.
                </p>
              </div>
            </div>

            {/* Cascada visible */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Fuentes que usará el agente
              </p>
              <div className="flex flex-col gap-1.5">
                {[
                  { label: 'Apollo', desc: 'Discovery de empresas por país e industria', active: true },
                  { label: 'HubSpot', desc: 'Detección de duplicados (solo lectura)', active: true },
                ].map((src) => (
                  <div
                    key={src.label}
                    className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-card px-3 py-2"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    <span className="text-xs font-medium text-foreground">{src.label}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{src.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </form>

          {/* Footer */}
          <SheetFooter className="shrink-0 border-t border-border/50 px-7 py-4">
            {generating && progressMsg && (
              <p className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {progressMsg}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClose}
                disabled={generating}
              >
                Cancelar
              </Button>
              <Button
                form="generate-ai-batch-form"
                type="submit"
                size="sm"
                disabled={!canSubmit}
                className="gap-1.5"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                {generating ? 'Generando…' : 'Generar empresas candidatas'}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

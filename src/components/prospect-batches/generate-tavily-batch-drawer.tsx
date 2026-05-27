'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, Globe, AlertCircle, CheckCircle2, Brain } from 'lucide-react';
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
import { generateTavilyProspectBatch } from '@/modules/prospect-batches/actions';
import { LATAM_COUNTRIES, INDUSTRIES } from '@/modules/prospect-batches/types';
import { Section, Field, Row, getFlagEmoji } from '@/components/accounts/account-form-helpers';

const EMPTY = {
  countryCode: '',
  industry: '',
};

export function GenerateTavilyBatchDrawer() {
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

    const country = LATAM_COUNTRIES.find((c) => c.code === form.countryCode);

    setGenerating(true);
    setProgressMsg('Iniciando búsqueda…');

    try {
      setProgressMsg('Buscando empresas en la web y evaluando resultados…');

      const result = await generateTavilyProspectBatch({
        country: country?.name ?? form.countryCode,
        countryCode: form.countryCode,
        industry: form.industry,
      });

      toast.success(
        `${result.candidatesCreated} empresa${result.candidatesCreated !== 1 ? 's' : ''} lista${result.candidatesCreated !== 1 ? 's' : ''} para revisión`,
        { description: 'Revisa los candidatos antes de aprobarlos.' }
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
        className="gap-1.5 bg-su-brand text-white hover:bg-su-brand/90 transition-colors"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Buscar empresas con IA
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
                  Buscar empresas con IA
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground/70">
                  SellUp buscará empresas en la web, evaluará los resultados con IA y dejará los mejores candidatos encontrados en revisión.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {/* Body */}
          <form
            id="generate-tavily-batch-form"
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

            {/* Info nota */}
            <div className="rounded-xl border border-border/40 bg-muted/40 px-4 py-3">
              <div className="flex gap-2.5">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <p className="text-xs text-muted-foreground">
                  Los candidatos no se aprueban automáticamente. La cantidad final puede variar según la disponibilidad y calidad de resultados.
                  <span className="mt-1 block text-muted-foreground/70">
                    Ninguna empresa se crea en SellUp sin revisión humana.
                  </span>
                </p>
              </div>
            </div>

            {/* Fuentes */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Cómo funciona
              </p>
              <div className="flex flex-col gap-1.5">
                {[
                  {
                    icon: Globe,
                    label: 'Búsqueda web',
                    desc: 'Encuentra empresas relevantes según país e industria',
                  },
                  {
                    icon: Brain,
                    label: 'Evaluación IA',
                    desc: 'Analiza y filtra los resultados más relevantes',
                  },
                  {
                    icon: CheckCircle2,
                    label: 'Deduplicación',
                    desc: 'Detecta si ya existen en SellUp o HubSpot',
                  },
                ].map((src) => (
                  <div
                    key={src.label}
                    className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-card px-3 py-2"
                  >
                    <src.icon className="h-3.5 w-3.5 shrink-0 text-su-brand" />
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
                form="generate-tavily-batch-form"
                type="submit"
                size="sm"
                disabled={!canSubmit}
                className="gap-1.5 bg-su-brand text-white hover:bg-su-brand/90 disabled:opacity-40"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {generating ? 'Buscando…' : 'Buscar empresas'}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

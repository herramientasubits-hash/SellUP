'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, Globe, CheckCircle2, Brain, Workflow } from "@/icons";
import { DrawerShell } from '@/components/shared/drawer-shell';
import { DrawerSection } from '@/components/shared/drawer-section';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AIButton } from '@/components/ai/ai-button';
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
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && handleClose()}
      trigger={
        <AIButton size="sm" onClick={() => setOpen(true)}>
          Buscar empresas con IA
        </AIButton>
      }
      title="Buscar empresas con IA"
      description="SellUp buscará empresas en la web, evaluará los resultados con IA y dejará los mejores candidatos encontrados en revisión."
      icon={<Sparkles className="h-4 w-4" />}
      size="xl"
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={generating}
          >
            Cancelar
          </Button>
          {generating && progressMsg && (
            <p
              role="status"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
              <span className="min-w-0 truncate" title={progressMsg}>{progressMsg}</span>
            </p>
          )}
          <AIButton
            form="generate-tavily-batch-form"
            type="submit"
            size="sm"
            disabled={!canSubmit}
            loading={generating}
          >
            {generating ? 'Buscando…' : 'Buscar empresas'}
          </AIButton>
        </>
      }
    >
      <form
        id="generate-tavily-batch-form"
        onSubmit={handleSubmit}
        className="space-y-4"
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
        <Alert variant="warning" role="note">
          <AlertDescription className="text-xs">
            <p>
              Los candidatos no se aprueban automáticamente. La cantidad final puede variar según la disponibilidad y calidad de resultados.
              <span className="mt-1 block">
                Ninguna empresa se crea en SellUp sin revisión humana.
              </span>
            </p>
          </AlertDescription>
        </Alert>

        {/* Fuentes */}
        <DrawerSection title="Cómo funciona" icon={Workflow} tone="neutral">
          <ul className="space-y-3">
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
              <li key={src.label} className="flex items-start gap-2.5">
                <src.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{src.label}</p>
                  <p className="text-xs text-muted-foreground">{src.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </DrawerSection>
      </form>
    </DrawerShell>
  );
}

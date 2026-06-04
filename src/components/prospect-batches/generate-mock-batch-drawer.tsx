'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, Loader2, Globe, Target, AlertTriangle, Info } from 'lucide-react';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { generateMockProspectingBatch } from '@/modules/prospect-batches/agent-actions';
import {
  LATAM_COUNTRIES,
  INDUSTRIES,
  BATCH_SEARCH_DEPTH_LABELS,
  type BatchSearchDepth,
} from '@/modules/prospect-batches/types';
import { Section, Field, Row, getFlagEmoji } from '@/components/accounts/account-form-helpers';

const DEFAULTS = {
  countryCode: 'CO',
  industry: 'Tecnología',
  targetCount: '5',
  searchDepth: 'standard' as BatchSearchDepth,
};

export function GenerateMockBatchDrawer() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ ...DEFAULTS });
  const [loading, setLoading] = React.useState(false);

  const set = <K extends keyof typeof DEFAULTS>(key: K, value: (typeof DEFAULTS)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleClose() {
    if (loading) return;
    setOpen(false);
    setForm({ ...DEFAULTS });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const country = LATAM_COUNTRIES.find((c) => c.code === form.countryCode);
    if (!country) {
      toast.error('Selecciona un país válido');
      return;
    }

    const count = parseInt(form.targetCount) || 5;

    setLoading(true);
    try {
      const result = await generateMockProspectingBatch({
        country: country.name,
        countryCode: form.countryCode,
        industry: form.industry,
        targetCount: count,
        searchDepth: form.searchDepth,
      });

      toast.success(
        `Lote mock generado con ${result.candidatesCreated} candidato${result.candidatesCreated !== 1 ? 's' : ''}`,
        { description: 'Listo para revisión. Recuerda que son datos de prueba.' }
      );

      setOpen(false);
      setForm({ ...DEFAULTS });
      router.push(`/prospect-batches/${result.batchId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al generar el lote de prueba');
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = !!form.countryCode && !!form.industry && !loading;

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && handleClose()}
      trigger={
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-1.5"
        >
          <FlaskConical className="h-3.5 w-3.5" />
          Lote de prueba
        </Button>
      }
      title="Generar lote de prueba"
      description="Prueba el pipeline completo con datos mock sin consumir ningún proveedor real."
      icon={<FlaskConical className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
      size="xl"
      actions={
        <div className="flex w-full items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button
            form="mock-batch-form"
            type="submit"
            size="sm"
            disabled={!canSubmit}
            variant="outline"
            className="gap-1.5 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400 disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FlaskConical className="h-3.5 w-3.5" />
            )}
            {loading ? 'Generando…' : 'Generar lote de prueba'}
          </Button>
        </div>
      }
    >
      <form
        id="mock-batch-form"
        onSubmit={handleSubmit}
        className="space-y-8"
      >
        {/* Alerta de seguridad */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="flex gap-2.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <p className="text-xs text-muted-foreground">
              Este modo usa datos mock para probar el flujo{' '}
              <strong className="font-medium text-foreground">
                sin consumir IA, Apollo, Lusha ni Tavily
              </strong>
              . Los candidatos generados no deben convertirse en empresas reales.
            </p>
          </div>
        </div>

        {/* Segmentación */}
        <Section icon={Globe} label="Segmentación">
          <Row>
            <Field label="País" required>
              <Select
                value={form.countryCode}
                onValueChange={(v) => set('countryCode', v ?? 'CO')}
                disabled={loading}
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
                onValueChange={(v) => set('industry', v ?? 'Tecnología')}
                disabled={loading}
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
                onValueChange={(v) => set('targetCount', v ?? '5')}
                disabled={loading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[3, 5, 10, 15, 20, 25].map((n) => (
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
                onValueChange={(v) =>
                  set('searchDepth', (v ?? 'standard') as BatchSearchDepth)
                }
                disabled={loading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['basic', 'standard', 'deep'] as BatchSearchDepth[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {BATCH_SEARCH_DEPTH_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Row>
        </Section>

        {/* Qué NO se usa */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Proveedores desactivados en modo prueba
          </p>
          <div className="flex flex-col gap-1.5">
            {[
              'Apollo — discovery desactivado',
              'Lusha — enriquecimiento desactivado',
              'Tavily — búsqueda web desactivada',
              'IA (LLM) — clasificación desactivada',
              'HubSpot — escritura desactivada',
            ].map((label) => (
              <div
                key={label}
                className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-card px-3 py-2"
              >
                <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </form>
    </DrawerShell>
  );
}

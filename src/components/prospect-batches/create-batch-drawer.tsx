'use client';

import * as React from 'react';
import { Plus, Loader2, Layers, Globe, Target, User, Zap } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { createProspectBatch } from '@/modules/prospect-batches/actions';
import {
  LATAM_COUNTRIES,
  INDUSTRIES,
  BATCH_SEARCH_DEPTH_LABELS,
  type InternalUserOption,
  type BatchSearchDepth,
} from '@/modules/prospect-batches/types';
import { Section, Field, Row, getFlagEmoji } from '@/components/accounts/account-form-helpers';

interface CreateBatchDrawerProps {
  users: InternalUserOption[];
}

const EMPTY: {
  name: string;
  description: string;
  country_code: string;
  industry: string;
  target_count: string;
  search_depth: BatchSearchDepth;
  owner_id: string;
} = {
  name: '',
  description: '',
  country_code: '',
  industry: '',
  target_count: '',
  search_depth: 'standard',
  owner_id: '',
};

export function CreateBatchDrawer({ users }: CreateBatchDrawerProps) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ ...EMPTY });
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleClose() {
    setOpen(false);
    setForm({ ...EMPTY });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('El nombre del lote es obligatorio');
      return;
    }
    setSaving(true);
    try {
      const country = LATAM_COUNTRIES.find((c) => c.code === form.country_code);
      await createProspectBatch({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        country: country?.name,
        country_code: form.country_code || undefined,
        industry: form.industry || undefined,
        target_count: form.target_count ? parseInt(form.target_count) : undefined,
        search_depth: form.search_depth,
        owner_id: form.owner_id || undefined,
      });
      toast.success('Lote creado correctamente');
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear el lote');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        Crear lote manual
      </Button>

      <Sheet open={open} onOpenChange={(v) => !v && handleClose()}>
        <SheetContent className="flex flex-col gap-0 overflow-hidden sm:w-[40vw] sm:min-w-[520px] sm:max-w-none">
          {/* Header */}
          <SheetHeader className="shrink-0 border-b border-border/50 px-7 pb-5 pt-6">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-su-brand-soft">
                <Layers className="h-4 w-4 text-su-brand" />
              </div>
              <div className="space-y-0.5">
                <SheetTitle className="text-base font-semibold">Nuevo lote manual</SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground/70">
                  Un lote agrupa empresas candidatas antes de convertirlas en prospectos con expediente propio.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {/* Body scrollable */}
          <form
            id="create-batch-form"
            onSubmit={handleSubmit}
            className="flex-1 space-y-8 overflow-y-auto px-7 py-6"
          >
            {/* Identificación */}
            <Section icon={Layers} label="Identificación">
              <Field label="Nombre del lote" required>
                <Input
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="Ej. Tech Colombia Q3 2026"
                  disabled={saving}
                  autoFocus
                />
              </Field>
              <Field label="Descripción">
                <Textarea
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="Objetivo, criterios de segmentación..."
                  rows={3}
                  disabled={saving}
                />
              </Field>
            </Section>

            {/* Segmentación */}
            <Section icon={Globe} label="Segmentación">
              <Row>
                <Field label="País">
                  <Select
                    value={form.country_code}
                    onValueChange={(v) => set('country_code', v ?? '')}
                    disabled={saving}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccionar" />
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
                <Field label="Industria">
                  <Select
                    value={form.industry}
                    onValueChange={(v) => set('industry', v ?? '')}
                    disabled={saving}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccionar" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDUSTRIES.map((ind) => (
                        <SelectItem key={ind} value={ind}>{ind}</SelectItem>
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
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={form.target_count}
                    onChange={(e) => set('target_count', e.target.value)}
                    placeholder="Ej. 50"
                    disabled={saving}
                  />
                </Field>
                <Field label="Profundidad de búsqueda">
                  <Select
                    value={form.search_depth}
                    onValueChange={(v) => set('search_depth', (v ?? 'standard') as BatchSearchDepth)}
                    disabled={saving}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(BATCH_SEARCH_DEPTH_LABELS) as [BatchSearchDepth, string][]).map(
                        ([key, label]) => (
                          <SelectItem key={key} value={key}>{label}</SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </Field>
              </Row>
            </Section>

            {/* Asignación */}
            {users.length > 0 && (
              <Section icon={User} label="Asignación">
                <Field label="Responsable (owner)">
                  <Select
                    value={form.owner_id}
                    onValueChange={(v) => set('owner_id', v ?? '')}
                    disabled={saving}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Sin asignar (tú por defecto)" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.full_name ?? u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </Section>
            )}
          </form>

          {/* Footer */}
          <SheetFooter className="shrink-0 border-t border-border/50 px-7 py-4">
            <div className="flex w-full items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClose}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button
                form="create-batch-form"
                type="submit"
                size="sm"
                disabled={saving}
                className="gap-1.5"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                Guardar lote
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

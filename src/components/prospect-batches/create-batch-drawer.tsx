'use client';

import * as React from 'react';
import {
  Plus,
  Loader2,
  Layers,
  Zap,
  Globe,
  Target,
  User,
} from "@/icons";
import { DrawerShell } from '@/components/shared/drawer-shell';
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
import { getFlagEmoji } from '@/components/accounts/account-form-helpers';
import { Field } from '@/components/forms/field';
import { DrawerSection } from '@/components/shared/drawer-section';
import { NumberField } from '@/components/forms/number-field';

interface CreateBatchDrawerProps {
  users: InternalUserOption[];
}

const MVP_MAX_CANDIDATES = 25;

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
  target_count: String(MVP_MAX_CANDIDATES),
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
    const parsedCount = form.target_count ? parseInt(form.target_count) : MVP_MAX_CANDIDATES;
    if (parsedCount > MVP_MAX_CANDIDATES) {
      toast.error(`El máximo permitido en el MVP es ${MVP_MAX_CANDIDATES} empresas candidatas por lote`);
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
    <DrawerShell
      open={open}
      onOpenChange={(v) => (v ? setOpen(true) : handleClose())}
      trigger={
        <Button onClick={() => setOpen(true)} size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Crear lote manual
        </Button>
      }
      title="Nuevo lote manual"
      description="Un lote agrupa empresas candidatas antes de convertirlas en prospectos con expediente propio."
      icon={<Layers className="h-4 w-4" />}
      size="xl"
      actions={
        <>
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
        </>
      }
    >
      <form
        id="create-batch-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        {/* Identificación */}
        <DrawerSection title="Identificación" icon={Layers} contentClassName="space-y-4">
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
        </DrawerSection>

        {/* Segmentación */}
        <DrawerSection title="Segmentación" icon={Globe} contentClassName="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>
        </DrawerSection>

        {/* Parámetros */}
        <DrawerSection title="Parámetros" icon={Target} contentClassName="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Cantidad objetivo"
              description={`Para cuidar calidad y costos, el MVP permite máximo ${MVP_MAX_CANDIDATES} empresas candidatas por lote.`}
            >
              <NumberField
                min={1}
                max={MVP_MAX_CANDIDATES}
                step={1}
                precision={0}
                value={form.target_count === '' ? null : Number(form.target_count)}
                onValueChange={(next) =>
                  // Mismo tope que antes: nunca queda guardado más del máximo,
                  // ni siquiera a medio escribir.
                  set(
                    'target_count',
                    next === null ? '' : String(Math.min(Math.trunc(next), MVP_MAX_CANDIDATES)),
                  )
                }
                placeholder="25"
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
          </div>
        </DrawerSection>

        {/* Asignación */}
        {users.length > 0 && (
          <DrawerSection title="Asignación" icon={User} contentClassName="space-y-4">
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
          </DrawerSection>
        )}
      </form>
    </DrawerShell>
  );
}

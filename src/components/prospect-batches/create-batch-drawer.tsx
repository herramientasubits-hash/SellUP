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

interface CreateBatchDrawerProps {
  users: InternalUserOption[];
}

function getFlagEmoji(code: string): string {
  const offset = 0x1f1e6 - 'A'.charCodeAt(0);
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(c.charCodeAt(0) + offset)).join('');
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

function Section({ icon: Icon, title, children }: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

export function CreateBatchDrawer({ users }: CreateBatchDrawerProps) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ ...EMPTY });
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

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
      setForm({ ...EMPTY });
      setOpen(false);
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
        Crear lote
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[70vw] overflow-y-auto"
        >
          <SheetHeader className="mb-6">
            <SheetTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-su-brand" />
              Nuevo lote de prospectos
            </SheetTitle>
            <SheetDescription>
              Los candidatos creados en este lote deben ser aprobados antes de convertirse en cuentas.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="space-y-7">
            {/* Identificación */}
            <Section icon={Layers} title="Identificación">
              <Field label="Nombre del lote *">
                <Input
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="Ej. Tech Colombia Q3 2026"
                  disabled={saving}
                />
              </Field>
              <Field label="Descripción">
                <Textarea
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="Objetivo del lote, criterios de búsqueda..."
                  rows={3}
                  disabled={saving}
                />
              </Field>
            </Section>

            {/* Segmentación */}
            <Section icon={Globe} title="Segmentación">
              <div className="grid grid-cols-2 gap-3">
                <Field label="País">
                  <Select
                    value={form.country_code}
                    onValueChange={(v) => set('country_code', v ?? '')}
                    disabled={saving}
                  >
                    <SelectTrigger>
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
                <Field label="Industria">
                  <Select
                    value={form.industry}
                    onValueChange={(v) => set('industry', v ?? '')}
                    disabled={saving}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar industria" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDUSTRIES.map((ind) => (
                        <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </Section>

            {/* Parámetros */}
            <Section icon={Target} title="Parámetros">
              <div className="grid grid-cols-2 gap-3">
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
                    <SelectTrigger>
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
            </Section>

            {/* Owner */}
            {users.length > 0 && (
              <Section icon={User} title="Asignación">
                <Field label="Responsable (owner)">
                  <Select
                    value={form.owner_id}
                    onValueChange={(v) => set('owner_id', v ?? '')}
                    disabled={saving}
                  >
                    <SelectTrigger>
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

            <SheetFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving} className="gap-1.5">
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                Guardar lote
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

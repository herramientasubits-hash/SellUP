'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Loader2,
  User,
  Mail,
  Phone,
  Link2,
  Briefcase,
  Star,
  FileText,
  Building2,
} from 'lucide-react';
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { createContact } from '@/modules/contacts/actions';
import {
  SENIORITY_LABELS,
  ROLE_LABELS,
  CONTACT_STATUS_LABELS,
  DEPARTMENTS,
  type ContactSeniority,
  type ContactRole,
  type ContactStatus,
} from '@/modules/contacts/types';
import { Section, Field, Row } from '@/components/accounts/account-form-helpers';

interface AccountOption {
  id: string;
  name: string;
}

interface CreateContactDrawerProps {
  accountId?: string;
  accounts?: AccountOption[];
}

const EMPTY_FORM = {
  account_id: '',
  first_name: '',
  last_name: '',
  full_name: '',
  email: '',
  phone: '',
  mobile_phone: '',
  linkedin_url: '',
  job_title: '',
  department: '',
  seniority: '' as ContactSeniority | '',
  role_in_account: '' as ContactRole | '',
  contact_status: 'active' as ContactStatus,
  is_primary: false,
  notes: '',
};

export function CreateContactDrawer({ accountId, accounts }: CreateContactDrawerProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleClose() {
    setOpen(false);
    setError(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const fullName =
      form.full_name.trim() ||
      [form.first_name.trim(), form.last_name.trim()].filter(Boolean).join(' ');

    if (!fullName) {
      setError('El nombre del contacto es requerido');
      return;
    }

    const resolvedAccountId = accountId ?? form.account_id;
    if (!resolvedAccountId) {
      setError('La cuenta es requerida');
      return;
    }

    setPending(true);
    try {
      const result = await createContact({
        account_id: resolvedAccountId,
        first_name: form.first_name || undefined,
        last_name: form.last_name || undefined,
        full_name: fullName,
        email: form.email || undefined,
        phone: form.phone || undefined,
        mobile_phone: form.mobile_phone || undefined,
        linkedin_url: form.linkedin_url || undefined,
        job_title: form.job_title || undefined,
        department: form.department || undefined,
        seniority: (form.seniority as ContactSeniority) || undefined,
        role_in_account: (form.role_in_account as ContactRole) || undefined,
        contact_status: form.contact_status,
        is_primary: form.is_primary,
        notes: form.notes || undefined,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      const name = fullName;
      handleClose();
      router.refresh();
      toast.success(`Contacto "${name}" creado`, {
        description: form.is_primary ? 'Marcado como contacto primario.' : undefined,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4" />
        Agregar contacto
      </Button>

      <Sheet open={open} onOpenChange={(v) => !v && handleClose()}>
        <SheetContent className="flex flex-col gap-0 overflow-hidden sm:w-[42vw] sm:min-w-[580px] sm:max-w-none">
          {/* Header */}
          <SheetHeader className="shrink-0 border-b border-border/50 px-7 pb-5 pt-6">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-su-brand-soft">
                <User className="h-4 w-4 text-su-brand" />
              </div>
              <div className="space-y-0.5">
                <SheetTitle className="text-base font-semibold">Nuevo contacto</SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground/70">
                  Registra un decisor, sponsor o persona clave vinculada a esta cuenta.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {/* Cuerpo */}
          <form
            id="create-contact-form"
            onSubmit={handleSubmit}
            className="flex-1 space-y-8 overflow-y-auto px-7 py-6"
          >
            {/* Cuenta (solo cuando no viene pre-seleccionada) */}
            {!accountId && accounts && accounts.length > 0 && (
              <Section icon={Building2} label="Cuenta">
                <Field label="Cuenta *">
                  <Select
                    value={form.account_id}
                    onValueChange={(v) => set('account_id', v ?? '')}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccionar cuenta…" />
                    </SelectTrigger>
                    <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </Section>
            )}

            {/* Identidad */}
            <Section icon={User} label="Identidad">
              <Row>
                <Field id="first_name" label="Nombre">
                  <Input
                    id="first_name"
                    placeholder="Juan"
                    value={form.first_name}
                    onChange={(e) => set('first_name', e.target.value)}
                    autoFocus
                  />
                </Field>
                <Field id="last_name" label="Apellido">
                  <Input
                    id="last_name"
                    placeholder="García"
                    value={form.last_name}
                    onChange={(e) => set('last_name', e.target.value)}
                  />
                </Field>
              </Row>
              <Field id="full_name" label="Nombre completo (opcional si usas los campos anteriores)">
                <Input
                  id="full_name"
                  placeholder="Se calcula automáticamente"
                  value={form.full_name}
                  onChange={(e) => set('full_name', e.target.value)}
                />
              </Field>
            </Section>

            {/* Contacto */}
            <Section icon={Mail} label="Datos de contacto">
              <Field id="email" label="Email corporativo">
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="juan.garcia@empresa.com"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    className="pl-8"
                  />
                </div>
              </Field>
              <Row>
                <Field id="phone" label="Teléfono">
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="+57 1 234 5678"
                      value={form.phone}
                      onChange={(e) => set('phone', e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </Field>
                <Field id="mobile_phone" label="Celular">
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
                    <Input
                      id="mobile_phone"
                      type="tel"
                      placeholder="+57 310 123 4567"
                      value={form.mobile_phone}
                      onChange={(e) => set('mobile_phone', e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </Field>
              </Row>
              <Field id="linkedin_url" label="LinkedIn">
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
                  <Input
                    id="linkedin_url"
                    type="url"
                    placeholder="https://linkedin.com/in/juangarcia"
                    value={form.linkedin_url}
                    onChange={(e) => set('linkedin_url', e.target.value)}
                    className="pl-8"
                  />
                </div>
              </Field>
            </Section>

            {/* Cargo y función */}
            <Section icon={Briefcase} label="Cargo y función">
              <Row>
                <Field id="job_title" label="Cargo">
                  <Input
                    id="job_title"
                    placeholder="Chief HR Officer"
                    value={form.job_title}
                    onChange={(e) => set('job_title', e.target.value)}
                  />
                </Field>
                <Field label="Área / Departamento">
                  <Select
                    value={form.department}
                    onValueChange={(v) => set('department', v ?? '')}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccionar área" />
                    </SelectTrigger>
                    <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
                      {DEPARTMENTS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </Row>
              <Row>
                <Field label="Seniority">
                  <Select
                    value={form.seniority}
                    onValueChange={(v) => set('seniority', (v as ContactSeniority) ?? '')}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Nivel jerárquico" />
                    </SelectTrigger>
                    <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
                      {(Object.entries(SENIORITY_LABELS) as [ContactSeniority, string][]).map(
                        ([k, label]) => (
                          <SelectItem key={k} value={k}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Rol en la cuenta">
                  <Select
                    value={form.role_in_account}
                    onValueChange={(v) => set('role_in_account', (v as ContactRole) ?? '')}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Decisor, Champion…" />
                    </SelectTrigger>
                    <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
                      {(Object.entries(ROLE_LABELS) as [ContactRole, string][]).map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </Row>
            </Section>

            {/* Estado y notas */}
            <Section icon={Star} label="Estado y prioridad">
              <Row>
                <Field label="Estado">
                  <Select
                    value={form.contact_status}
                    onValueChange={(v) => set('contact_status', (v as ContactStatus) ?? 'active')}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
                      {(Object.entries(CONTACT_STATUS_LABELS) as [ContactStatus, string][]).map(
                        ([k, label]) => (
                          <SelectItem key={k} value={k}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </Field>
                <label htmlFor="is_primary" className="flex cursor-pointer items-center gap-2.5 pt-6">
                  <input
                    id="is_primary"
                    type="checkbox"
                    checked={form.is_primary}
                    onChange={(e) => set('is_primary', e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-[hsl(var(--su-brand))]"
                  />
                  <span className="text-xs font-medium text-foreground/70">Contacto primario</span>
                </label>
              </Row>
              <Field id="notes" label="Notas">
                <div className="relative">
                  <FileText className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/40" />
                  <Textarea
                    id="notes"
                    placeholder="Contexto, señales de interés, último contacto…"
                    value={form.notes}
                    onChange={(e) => set('notes', e.target.value)}
                    rows={3}
                    className="pl-8 pt-2 text-sm"
                  />
                </div>
              </Field>
            </Section>
          </form>

          {/* Footer */}
          <SheetFooter className="shrink-0 flex-row items-center justify-between gap-3 border-t border-border/50 px-7 py-4">
            {error && (
              <p className="flex-1 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClose}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                form="create-contact-form"
                size="sm"
                disabled={pending}
              >
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  'Guardar contacto'
                )}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

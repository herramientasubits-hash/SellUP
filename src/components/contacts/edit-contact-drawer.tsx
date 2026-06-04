'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  User,
  Mail,
  Phone,
  Link2,
  Briefcase,
  Star,
  FileText,
} from 'lucide-react';
import { DrawerShell } from '@/components/shared/drawer-shell';
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
import { updateContact } from '@/modules/contacts/actions';
import {
  SENIORITY_LABELS,
  ROLE_LABELS,
  CONTACT_STATUS_LABELS,
  DEPARTMENTS,
  type Contact,
  type ContactSeniority,
  type ContactRole,
  type ContactStatus,
} from '@/modules/contacts/types';
import { Section, Field, Row } from '@/components/accounts/account-form-helpers';

interface EditContactDrawerProps {
  contact: Contact;
  open: boolean;
  onClose: () => void;
}

function buildFormValues(contact: Contact) {
  return {
    first_name: contact.first_name ?? '',
    last_name: contact.last_name ?? '',
    full_name: contact.full_name,
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    mobile_phone: contact.mobile_phone ?? '',
    linkedin_url: contact.linkedin_url ?? '',
    job_title: contact.job_title ?? '',
    department: contact.department ?? '',
    seniority: (contact.seniority ?? '') as ContactSeniority | '',
    role_in_account: (contact.role_in_account ?? '') as ContactRole | '',
    contact_status: contact.contact_status,
    is_primary: contact.is_primary,
    notes: contact.notes ?? '',
  };
}

export function EditContactDrawer({ contact, open, onClose }: EditContactDrawerProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [form, setForm] = React.useState(() => buildFormValues(contact));

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
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

    setPending(true);
    try {
      const result = await updateContact(contact.id, {
        first_name: form.first_name || undefined,
        last_name: form.last_name || undefined,
        full_name: fullName,
        email: form.email || undefined,
        phone: form.phone || undefined,
        mobile_phone: form.mobile_phone || undefined,
        linkedin_url: form.linkedin_url || undefined,
        job_title: form.job_title || undefined,
        department: form.department || undefined,
        seniority: (form.seniority as ContactSeniority) || null,
        role_in_account: (form.role_in_account as ContactRole) || null,
        contact_status: form.contact_status,
        is_primary: form.is_primary,
        notes: form.notes || undefined,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      onClose();
      router.refresh();
      toast.success('Contacto actualizado');
    } finally {
      setPending(false);
    }
  }

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Editar contacto"
      description={contact.full_name}
      icon={<User className="h-4 w-4 text-su-brand" />}
      size="xl"
      actions={
        <>
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
              onClick={onClose}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" form="edit-contact-form" size="sm" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : (
                'Guardar cambios'
              )}
            </Button>
          </div>
        </>
      }
    >
      <form
        id="edit-contact-form"
        onSubmit={handleSubmit}
        className="space-y-8"
      >
        {/* Identidad */}
        <Section icon={User} label="Identidad">
          <Row>
            <Field id="edit_first_name" label="Nombre">
              <Input
                id="edit_first_name"
                placeholder="Juan"
                value={form.first_name}
                onChange={(e) => set('first_name', e.target.value)}
              />
            </Field>
            <Field id="edit_last_name" label="Apellido">
              <Input
                id="edit_last_name"
                placeholder="García"
                value={form.last_name}
                onChange={(e) => set('last_name', e.target.value)}
              />
            </Field>
          </Row>
          <Field id="edit_full_name" label="Nombre completo">
            <Input
              id="edit_full_name"
              placeholder="Nombre completo"
              value={form.full_name}
              onChange={(e) => set('full_name', e.target.value)}
            />
          </Field>
        </Section>

        {/* Contacto */}
        <Section icon={Mail} label="Datos de contacto">
          <Field id="edit_email" label="Email corporativo">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
              <Input
                id="edit_email"
                type="email"
                placeholder="juan.garcia@empresa.com"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                className="pl-8"
              />
            </div>
          </Field>
          <Row>
            <Field id="edit_phone" label="Teléfono">
              <div className="relative">
                <Phone className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
                <Input
                  id="edit_phone"
                  type="tel"
                  placeholder="+57 1 234 5678"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  className="pl-8"
                />
              </div>
            </Field>
            <Field id="edit_mobile_phone" label="Celular">
              <div className="relative">
                <Phone className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
                <Input
                  id="edit_mobile_phone"
                  type="tel"
                  placeholder="+57 310 123 4567"
                  value={form.mobile_phone}
                  onChange={(e) => set('mobile_phone', e.target.value)}
                  className="pl-8"
                />
              </div>
            </Field>
          </Row>
          <Field id="edit_linkedin" label="LinkedIn">
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
              <Input
                id="edit_linkedin"
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
            <Field id="edit_job_title" label="Cargo">
              <Input
                id="edit_job_title"
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

        {/* Estado y prioridad */}
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
            <label htmlFor="edit_is_primary" className="flex cursor-pointer items-center gap-2.5 pt-6">
              <input
                id="edit_is_primary"
                type="checkbox"
                checked={form.is_primary}
                onChange={(e) => set('is_primary', e.target.checked)}
                className="h-4 w-4 rounded border-border accent-[hsl(var(--su-brand))]"
              />
              <span className="text-xs font-medium text-foreground/70">Contacto primario</span>
            </label>
          </Row>
          <Field id="edit_notes" label="Notas">
            <div className="relative">
              <FileText className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/40" />
              <Textarea
                id="edit_notes"
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
    </DrawerShell>
  );
}

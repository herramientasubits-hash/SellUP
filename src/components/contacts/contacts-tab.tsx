'use client';

import * as React from 'react';
import { Star, Mail, Phone, Users, Crown, Target, Archive } from 'lucide-react';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  SENIORITY_LABELS,
  ROLE_LABELS,
  CONTACT_STATUS_LABELS,
  CONTACT_SOURCE_LABELS,
  type Contact,
  type ContactsSummary,
} from '@/modules/contacts/types';
import { CreateContactDrawer } from './create-contact-drawer';
import { ContactRowActions } from './contact-row-actions';

interface ContactsTabProps {
  accountId: string;
  contacts: Contact[];
  summary: ContactsSummary;
}

// ── Estilos de estado ─────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-transparent',
  inactive: 'bg-muted text-muted-foreground border-transparent',
  left_company: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-transparent',
  do_not_contact: 'bg-destructive/10 text-destructive border-transparent',
  archived: 'bg-muted/60 text-muted-foreground/60 border-transparent',
};

const ROLE_STYLES: Record<string, string> = {
  decision_maker: 'bg-su-brand-soft text-su-brand border-transparent',
  economic_buyer: 'bg-su-brand-soft text-su-brand border-transparent',
  champion: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-transparent',
  influencer: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-transparent',
};

// ── Componente principal ──────────────────────────────────────

export function ContactsTab({ accountId, contacts, summary }: ContactsTabProps) {
  return (
    <div className="space-y-4">
      {/* Header interno + botón */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Contactos</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Decisores, sponsors y personas clave vinculadas a esta cuenta.
          </p>
        </div>
        <CreateContactDrawer accountId={accountId} />
      </div>

      {/* Summary mini-cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          icon={Users}
          label="Total"
          value={summary.total}
          color="text-foreground"
        />
        <SummaryCard
          icon={Crown}
          label="Decisores"
          value={summary.decision_makers}
          color="text-su-brand"
        />
        <SummaryCard
          icon={Target}
          label="Champions"
          value={summary.champions}
          color="text-emerald-500"
        />
        <SummaryCard
          icon={Archive}
          label="Inactivos"
          value={summary.inactive_or_archived}
          color="text-muted-foreground"
        />
      </div>

      {/* Tabla de contactos */}
      {contacts.length === 0 ? (
        <EmptyState />
      ) : (
        <SurfaceCard className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 text-[11px]">Nombre</TableHead>
                <TableHead className="text-[11px]">Cargo</TableHead>
                <TableHead className="text-[11px]">Rol</TableHead>
                <TableHead className="text-[11px]">Seniority</TableHead>
                <TableHead className="text-[11px]">Email</TableHead>
                <TableHead className="text-[11px]">Teléfono</TableHead>
                <TableHead className="text-[11px]">Estado</TableHead>
                <TableHead className="text-[11px]">Fuente</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <ContactRow key={contact.id} contact={contact} />
              ))}
            </TableBody>
          </Table>
        </SurfaceCard>
      )}
    </div>
  );
}

// ── Fila de contacto ──────────────────────────────────────────

function ContactRow({ contact }: { contact: Contact }) {
  return (
    <TableRow className="group">
      <TableCell className="pl-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground/70">
            {contact.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-foreground truncate">
                {contact.full_name}
              </span>
              {contact.is_primary && (
                <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
              )}
            </div>
          </div>
        </div>
      </TableCell>

      <TableCell>
        <span className="text-xs text-foreground/80 truncate max-w-[120px] block">
          {contact.job_title ?? <span className="text-muted-foreground/40">—</span>}
        </span>
      </TableCell>

      <TableCell>
        {contact.role_in_account ? (
          <Badge
            variant="outline"
            className={`text-[10px] ${ROLE_STYLES[contact.role_in_account] ?? 'bg-muted text-muted-foreground border-transparent'}`}
          >
            {ROLE_LABELS[contact.role_in_account]}
          </Badge>
        ) : (
          <span className="text-muted-foreground/40 text-xs">—</span>
        )}
      </TableCell>

      <TableCell>
        {contact.seniority ? (
          <span className="text-xs text-foreground/70">
            {SENIORITY_LABELS[contact.seniority]}
          </span>
        ) : (
          <span className="text-muted-foreground/40 text-xs">—</span>
        )}
      </TableCell>

      <TableCell>
        {contact.email ? (
          <a
            href={`mailto:${contact.email}`}
            className="flex items-center gap-1 text-xs text-su-brand hover:underline"
          >
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[140px]">{contact.email}</span>
          </a>
        ) : (
          <span className="text-muted-foreground/40 text-xs">—</span>
        )}
      </TableCell>

      <TableCell>
        {contact.phone ?? contact.mobile_phone ? (
          <a
            href={`tel:${contact.mobile_phone ?? contact.phone}`}
            className="flex items-center gap-1 text-xs text-foreground/70 hover:text-foreground"
          >
            <Phone className="h-3 w-3 shrink-0" />
            {contact.mobile_phone ?? contact.phone}
          </a>
        ) : (
          <span className="text-muted-foreground/40 text-xs">—</span>
        )}
      </TableCell>

      <TableCell>
        <Badge
          variant="outline"
          className={`text-[10px] ${STATUS_STYLES[contact.contact_status] ?? ''}`}
        >
          {CONTACT_STATUS_LABELS[contact.contact_status]}
        </Badge>
      </TableCell>

      <TableCell>
        <Badge variant="outline" className="text-[10px] bg-muted/40 border-transparent text-muted-foreground">
          {CONTACT_SOURCE_LABELS[contact.source]}
        </Badge>
      </TableCell>

      <TableCell>
        <ContactRowActions contact={contact} />
      </TableCell>
    </TableRow>
  );
}

// ── Summary card ──────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <SurfaceCard className="p-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60">
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </div>
        <div>
          <p className="text-lg font-semibold leading-none text-foreground">{value}</p>
          <p className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">
            {label}
          </p>
        </div>
      </div>
    </SurfaceCard>
  );
}

// ── Estado vacío ──────────────────────────────────────────────

function EmptyState() {
  return (
    <SurfaceCard>
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60">
          <Users className="h-5 w-5 text-muted-foreground/40" />
        </div>
        <div className="max-w-xs space-y-1">
          <p className="text-sm font-semibold text-foreground">Sin contactos todavía</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Todavía no hay contactos asociados a esta cuenta. Agrega un contacto manualmente o,
            más adelante, enriquécelo con Apollo o Lusha.
          </p>
        </div>
      </div>
    </SurfaceCard>
  );
}

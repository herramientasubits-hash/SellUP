import Link from 'next/link';
import { Users, Crown, Target, Star, Mail, Phone } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
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
import { getAllContacts } from '@/modules/contacts/actions';
import {
  ROLE_LABELS,
  SENIORITY_LABELS,
  CONTACT_STATUS_LABELS,
  CONTACT_SOURCE_LABELS,
  type ContactStatus,
  type ContactRole,
} from '@/modules/contacts/types';

const STATUS_STYLES: Record<ContactStatus, string> = {
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

export default async function ContactsPage() {
  const contacts = await getAllContacts();

  const total = contacts.length;
  const decisionMakers = contacts.filter((c) => c.role_in_account === 'decision_maker').length;
  const champions = contacts.filter((c) => c.role_in_account === 'champion').length;
  const primary = contacts.filter((c) => c.is_primary).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contactos"
        description="Decisores, sponsors y personas clave de todas las cuentas."
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Users, label: 'Total', value: total, color: 'text-foreground' },
          { icon: Crown, label: 'Decisores', value: decisionMakers, color: 'text-su-brand' },
          { icon: Target, label: 'Champions', value: champions, color: 'text-emerald-500' },
          { icon: Star, label: 'Primarios', value: primary, color: 'text-amber-500' },
        ].map(({ icon: Icon, label, value, color }) => (
          <SurfaceCard key={label} className="p-3">
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
        ))}
      </div>

      {/* Tabla */}
      {contacts.length === 0 ? (
        <SurfaceCard>
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60">
              <Users className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <div className="max-w-xs space-y-1">
              <p className="text-sm font-semibold text-foreground">Sin contactos todavía</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Agrega contactos desde el detalle de cada cuenta.
              </p>
            </div>
          </div>
        </SurfaceCard>
      ) : (
        <SurfaceCard className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 text-[11px]">Nombre</TableHead>
                <TableHead className="text-[11px]">Cuenta</TableHead>
                <TableHead className="text-[11px]">Cargo</TableHead>
                <TableHead className="text-[11px]">Rol</TableHead>
                <TableHead className="text-[11px]">Seniority</TableHead>
                <TableHead className="text-[11px]">Email</TableHead>
                <TableHead className="text-[11px]">Teléfono</TableHead>
                <TableHead className="text-[11px]">Estado</TableHead>
                <TableHead className="text-[11px]">Fuente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow key={contact.id} className="group">
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground/70">
                        {contact.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground">
                          {contact.full_name}
                        </span>
                        {contact.is_primary && (
                          <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    {contact.account_name ? (
                      <Link
                        href={`/accounts/${contact.account_id}`}
                        className="text-xs text-su-brand hover:underline"
                      >
                        {contact.account_name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground/40 text-xs">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <span className="text-xs text-foreground/80">
                      {contact.job_title ?? <span className="text-muted-foreground/40">—</span>}
                    </span>
                  </TableCell>

                  <TableCell>
                    {contact.role_in_account ? (
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${ROLE_STYLES[contact.role_in_account] ?? 'bg-muted text-muted-foreground border-transparent'}`}
                      >
                        {ROLE_LABELS[contact.role_in_account as ContactRole]}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground/40 text-xs">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <span className="text-xs text-foreground/70">
                      {contact.seniority
                        ? SENIORITY_LABELS[contact.seniority]
                        : <span className="text-muted-foreground/40">—</span>}
                    </span>
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
                      className={`text-[10px] ${STATUS_STYLES[contact.contact_status]}`}
                    >
                      {CONTACT_STATUS_LABELS[contact.contact_status]}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-muted/40 border-transparent text-muted-foreground"
                    >
                      {CONTACT_SOURCE_LABELS[contact.source]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SurfaceCard>
      )}
    </div>
  );
}

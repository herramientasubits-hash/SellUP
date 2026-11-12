'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, DataTableColumnHeader } from '@/components/data-table';
import { StatusBadge, type StatusType } from '@/components/data-display/status-badge';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { EmptyState } from '@/components/ui/empty-state';
import { formatAppDateTime } from '@/lib/format-date';
import type { BulletinModel } from '@/modules/bulletin/bulletin-model';
import { BulletinPreview } from './bulletin-preview';
import {
  formatPeriod,
  frequencyLabel,
  type BulletinDeliveryRow,
  type NotificationSettingsActions,
} from './notification-settings-types';

// ============================================================
// «Historial»: los boletines enviados. Al abrir uno se pinta igual que la
// vista previa, con el modelo guardado en el envío.
// ============================================================

const DELIVERY_STATUS: Record<string, { status: StatusType; label: string }> = {
  sent: { status: 'completed', label: 'Enviado' },
  failed: { status: 'error', label: 'Falló' },
  not_in_slack: { status: 'warning', label: 'No está en Slack' },
};

function deliveryStatus(status: string): { status: StatusType; label: string } {
  return DELIVERY_STATUS[status] ?? { status: 'neutral', label: status };
}

interface BulletinHistoryProps {
  history: BulletinDeliveryRow[];
  getBulletinDelivery: NotificationSettingsActions['getBulletinDelivery'];
}

export function BulletinHistory({ history, getBulletinDelivery }: BulletinHistoryProps) {
  const [open, setOpen] = useState<BulletinDeliveryRow | null>(null);
  const [model, setModel] = useState<BulletinModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const openRow = async (row: BulletinDeliveryRow) => {
    setOpen(row);
    setModel(null);
    setError(null);
    setLoading(true);
    const result = await getBulletinDelivery(row.id);
    setLoading(false);
    if (result.success) setModel(result.data);
    else setError(result.error);
  };

  const columns = useMemo<ColumnDef<BulletinDeliveryRow, unknown>[]>(
    () => [
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-sm tabular-nums">{formatAppDateTime(row.original.createdAt)}</span>,
        meta: { label: 'Fecha', disableFilter: true },
      },
      {
        id: 'recipientName',
        accessorKey: 'recipientName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Para" />,
        cell: ({ row }) => <span className="text-sm font-medium text-foreground">{row.original.recipientName}</span>,
        meta: { label: 'Para' },
      },
      {
        id: 'frequency',
        accessorFn: (row) => frequencyLabel(row.frequency),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Frecuencia" />,
        cell: ({ getValue }) => <span className="text-sm text-muted-foreground">{getValue<string>()}</span>,
        meta: { label: 'Frecuencia' },
      },
      {
        id: 'period',
        accessorFn: (row) => formatPeriod(row.periodStart, row.periodEnd),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Período" />,
        cell: ({ getValue }) => <span className="whitespace-nowrap text-sm text-muted-foreground">{getValue<string>()}</span>,
        meta: { label: 'Período', disableFilter: true },
      },
      {
        id: 'status',
        accessorFn: (row) => deliveryStatus(row.status).label,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
        cell: ({ row }) => {
          const s = deliveryStatus(row.original.status);
          return <StatusBadge status={s.status} label={s.label} />;
        },
        meta: { label: 'Estado' },
      },
      {
        id: 'manual',
        accessorFn: (row) => (row.manual ? 'Prueba manual' : 'Automático'),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Origen" />,
        cell: ({ getValue }) => <span className="text-sm text-muted-foreground">{getValue<string>()}</span>,
        meta: { label: 'Origen' },
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        tableId="settings-bulletin-history"
        columns={columns}
        data={history}
        getRowId={(row) => row.id}
        getRowLabel={(row) => `Boletín de ${row.recipientName}`}
        noun="boletines"
        nounGender="m"
        onRowClick={(row) => void openRow(row)}
        rowClickable
        emptyState={
          <EmptyState title="Aún no se ha enviado ningún boletín" description="Aquí aparecen los boletines automáticos y las pruebas que envíes." />
        }
      />

      <DrawerShell
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
        title={open ? `Boletín ${frequencyLabel(open.frequency).toLowerCase()} de ${open.recipientName}` : 'Boletín'}
        description={open ? `${formatPeriod(open.periodStart, open.periodEnd)} · ${formatAppDateTime(open.createdAt)}` : undefined}
        titleBadge={open ? <StatusBadge status={deliveryStatus(open.status).status} label={deliveryStatus(open.status).label} /> : undefined}
        size="3xl"
        loading={loading}
      >
        {error && <p className="text-sm text-destructive">{error}</p>}
        {model && <BulletinPreview model={model} />}
      </DrawerShell>
    </>
  );
}

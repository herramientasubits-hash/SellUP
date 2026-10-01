'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Check, X, Pause, UserCog, Archive, RotateCcw, Users, KeyRound, Loader2 } from "@/icons";
import { RowActionsMenu, type RowAction } from '@/components/data-display';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ModalShell } from '@/components/shared/modal-shell';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FieldLabel } from '@/components/forms/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  approveUser,
  rejectUser,
  suspendUser,
  reactivateUser,
  changeUserRole,
  changeUserManager,
  changeUserGroup,
  archiveUser,
  activateFromRejected,
} from '@/modules/access/actions';
import type { InternalUser, Role, OrganizationGroup } from '@/modules/access/types';
import { formatGroupDisplayName, formatGroupLabel } from '@/modules/access/display-helpers';

const SELF_MANAGER_VALUE = '__self__';
const NO_GROUP_VALUE = '__no_group__';
const GENERIC_ERROR = 'No se pudo completar la acción. Inténtalo de nuevo.';

type ActionResult = { success: boolean; error?: string };

/** El diálogo abierto. Uno solo a la vez: nunca un modal sobre otro. */
type DialogKind =
  | 'approve'
  | 'reject'
  | 'suspend'
  | 'reactivate'
  | 'role'
  | 'manager'
  | 'group'
  | 'archive'
  | 'activate-rejected';

interface UserActionsProps {
  user: InternalUser;
  roles: Role[];
  activeUsers: InternalUser[];
  groups: OrganizationGroup[];
}

// ─── Campos compartidos por los diálogos ─────────────────────────────────────

interface RoleSelectProps {
  roles: Role[];
  value: string;
  onChange: (value: string) => void;
}

function RoleSelect({ roles, value, onChange }: RoleSelectProps) {
  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v || '')}>
      <SelectTrigger className="w-full" aria-label="Rol">
        <SelectValue placeholder="Seleccionar rol" />
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role.id} value={role.id}>
            {role.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface ManagerSelectProps {
  managers: InternalUser[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

function ManagerSelect({ managers, value, onChange, placeholder }: ManagerSelectProps) {
  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v || '')}>
      <SelectTrigger className="w-full" aria-label="Jefe directo">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SELF_MANAGER_VALUE}>Sin jefe directo</SelectItem>
        {managers.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.full_name ?? u.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ActionError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

interface SaveButtonProps {
  label: string;
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function SaveButton({ label, loading, disabled = false, onClick }: SaveButtonProps) {
  return (
    <Button type="button" onClick={onClick} disabled={disabled || loading}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {label}
    </Button>
  );
}

// ─── Qué se puede hacer con cada persona, según su estado ────────────────────

function buildRowActions(
  user: InternalUser,
  openDialog: (kind: DialogKind) => void,
): RowAction[] {
  const archive: RowAction = {
    id: 'archive',
    label: 'Archivar usuario',
    icon: <Archive />,
    tone: 'danger',
    separatorBefore: true,
    onSelect: () => openDialog('archive'),
  };
  const suspend: RowAction = {
    id: 'suspend',
    label: 'Suspender acceso',
    icon: <Pause />,
    tone: 'danger',
    onSelect: () => openDialog('suspend'),
  };

  switch (user.access_status) {
    case 'pending_approval':
      return [
        { id: 'approve', label: 'Aprobar y asignar rol', icon: <Check />, onSelect: () => openDialog('approve') },
        { id: 'reject', label: 'Rechazar solicitud', icon: <X />, tone: 'danger', onSelect: () => openDialog('reject') },
      ];
    case 'active':
      return [
        { id: 'role', label: 'Cambiar rol', icon: <KeyRound />, onSelect: () => openDialog('role') },
        { id: 'manager', label: 'Cambiar jefe directo', icon: <UserCog />, onSelect: () => openDialog('manager') },
        { id: 'group', label: 'Asignar grupo', icon: <Users />, onSelect: () => openDialog('group') },
        { ...suspend, separatorBefore: true },
      ];
    case 'suspended':
      return [
        { id: 'reactivate', label: 'Reactivar acceso', icon: <RotateCcw />, onSelect: () => openDialog('reactivate') },
        archive,
      ];
    case 'rejected':
      return [
        { id: 'activate-rejected', label: 'Activar y asignar rol', icon: <Check />, onSelect: () => openDialog('activate-rejected') },
        suspend,
        archive,
      ];
    default:
      return [];
  }
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function UserActions({ user, roles, activeUsers, groups }: UserActionsProps) {
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [selectedManager, setSelectedManager] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userName = user.full_name ?? user.email;

  // Possible managers: active users excluding the user being edited
  const possibleManagers = activeUsers.filter((u) => u.id !== user.id);

  const resolveManagerId = (val: string): string | null =>
    val === SELF_MANAGER_VALUE || val === '' ? null : val;

  /** Cada diálogo abre con los valores actuales de la persona. */
  const openDialog = (kind: DialogKind) => {
    setError(null);
    if (kind === 'role') setSelectedRole(user.role_id ?? '');
    if (kind === 'manager') setSelectedManager(user.manager_id ?? SELF_MANAGER_VALUE);
    if (kind === 'group') setSelectedGroup(user.group_id ?? NO_GROUP_VALUE);
    if (kind === 'activate-rejected') {
      setSelectedRole('');
      setSelectedManager('');
    }
    setDialog(kind);
  };

  const closeDialog = () => {
    setDialog(null);
    setError(null);
  };

  const onOpenChangeFor = (kind: DialogKind) => (open: boolean) => {
    if (open) setDialog(kind);
    else closeDialog();
  };

  /** Si la acción falla, el diálogo sigue abierto y dice por qué. */
  const run = async (action: () => Promise<ActionResult>) => {
    setLoading(true);
    setError(null);
    let result: ActionResult;
    try {
      result = await action();
    } catch {
      result = { success: false };
    }
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? GENERIC_ERROR);
      return;
    }
    closeDialog();
    window.location.reload();
  };

  const handleApprove = () => {
    if (!selectedRole) return;
    void run(() => approveUser(user.id, selectedRole, resolveManagerId(selectedManager)));
  };
  const handleReject = () => void run(() => rejectUser(user.id));
  const handleSuspend = () => void run(() => suspendUser(user.id));
  const handleReactivate = () => void run(() => reactivateUser(user.id));
  const handleRoleChange = () => {
    if (!selectedRole) return;
    void run(() => changeUserRole(user.id, selectedRole));
  };
  const handleManagerChange = () => {
    if (!selectedManager) return;
    void run(() => changeUserManager(user.id, resolveManagerId(selectedManager)));
  };
  const handleGroupChange = () => {
    const newGroupId = selectedGroup === NO_GROUP_VALUE || selectedGroup === '' ? null : selectedGroup;
    void run(() => changeUserGroup(user.id, newGroupId));
  };
  const handleArchive = () => void run(() => archiveUser(user.id));
  const handleActivateFromRejected = () => {
    if (!selectedRole) return;
    void run(() => activateFromRejected(user.id, selectedRole, resolveManagerId(selectedManager)));
  };

  const cancelButton = (
    <Button type="button" variant="outline" onClick={closeDialog} disabled={loading}>
      Cancelar
    </Button>
  );

  /**
   * La pregunta de una confirmación y, si la acción falló, el motivo debajo.
   * La descripción del diálogo es un párrafo: el error va como texto, no como
   * una caja `Alert` (un bloque dentro de un párrafo no es HTML válido).
   */
  const confirmDescription = (text: string): ReactNode => (
    <>
      {text}
      {error && (
        <span role="alert" className="mt-2 block font-medium text-destructive">
          {error}
        </span>
      )}
    </>
  );

  return (
    <>
      <RowActionsMenu rowLabel={userName} actions={buildRowActions(user, openDialog)} />

      {/* Approve Dialog */}
      <ModalShell
        open={dialog === 'approve'}
        onOpenChange={onOpenChangeFor('approve')}
        title="Aprobar solicitud"
        description={<>Asigna un rol y jefe directo a {userName}.</>}
        actions={
          <>
            {cancelButton}
            <SaveButton
              label="Aprobar acceso"
              loading={loading}
              disabled={!selectedRole || !selectedManager}
              onClick={handleApprove}
            />
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel className="block leading-none">Rol</FieldLabel>
            <RoleSelect roles={roles} value={selectedRole} onChange={setSelectedRole} />
          </div>
          <div className="space-y-1.5">
            <FieldLabel className="block leading-none">Jefe directo</FieldLabel>
            <ManagerSelect
              managers={possibleManagers}
              value={selectedManager}
              onChange={setSelectedManager}
              placeholder="Seleccionar jefe directo"
            />
          </div>
          <ActionError message={error} />
        </div>
      </ModalShell>

      {/* Change Manager Dialog */}
      <ModalShell
        open={dialog === 'manager'}
        onOpenChange={onOpenChangeFor('manager')}
        title="Cambiar jefe directo"
        description={<>Actualiza el jefe directo de {userName} en el organigrama.</>}
        actions={
          <>
            {cancelButton}
            <SaveButton label="Guardar" loading={loading} disabled={!selectedManager} onClick={handleManagerChange} />
          </>
        }
      >
        <div className="space-y-4">
          <ManagerSelect
            managers={possibleManagers}
            value={selectedManager}
            onChange={setSelectedManager}
            placeholder="Seleccionar jefe directo"
          />
          <ActionError message={error} />
        </div>
      </ModalShell>

      {/* Reject Dialog */}
      <ConfirmDialog
        open={dialog === 'reject'}
        onOpenChange={onOpenChangeFor('reject')}
        variant="destructive"
        icon={X}
        title="Rechazar solicitud"
        description={confirmDescription(`¿Estás seguro de que deseas rechazar la solicitud de ${userName}?`)}
        confirmLabel="Rechazar"
        loading={loading}
        onConfirm={handleReject}
      />

      {/* Suspend Dialog */}
      <ConfirmDialog
        open={dialog === 'suspend'}
        onOpenChange={onOpenChangeFor('suspend')}
        variant="destructive"
        icon={Pause}
        title="Suspender acceso"
        description={confirmDescription(
          `¿Estás seguro de que deseas suspender el acceso de ${userName}? El usuario no podrá acceder a SellUp hasta que su acceso sea reactivado.`,
        )}
        confirmLabel="Suspender"
        loading={loading}
        onConfirm={handleSuspend}
      />

      {/* Reactivate Dialog */}
      <ConfirmDialog
        open={dialog === 'reactivate'}
        onOpenChange={onOpenChangeFor('reactivate')}
        icon={RotateCcw}
        title="Reactivar acceso"
        description={confirmDescription(`¿Estás seguro de que deseas reactivar el acceso de ${userName}?`)}
        confirmLabel="Reactivar"
        loading={loading}
        onConfirm={handleReactivate}
      />

      {/* Change Role Dialog */}
      <ModalShell
        open={dialog === 'role'}
        onOpenChange={onOpenChangeFor('role')}
        title="Cambiar rol"
        description={<>Asigna un nuevo rol a {userName}.</>}
        actions={
          <>
            {cancelButton}
            <SaveButton label="Guardar" loading={loading} disabled={!selectedRole} onClick={handleRoleChange} />
          </>
        }
      >
        <div className="space-y-4">
          <RoleSelect roles={roles} value={selectedRole} onChange={setSelectedRole} />
          <ActionError message={error} />
        </div>
      </ModalShell>

      {/* Archive Dialog */}
      <ConfirmDialog
        open={dialog === 'archive'}
        onOpenChange={onOpenChangeFor('archive')}
        variant="destructive"
        icon={Archive}
        title="Archivar usuario"
        description={confirmDescription(
          `${userName} quedará archivado y no podrá acceder a SellUp. Esta acción es reversible solo por un administrador.`,
        )}
        confirmLabel="Archivar"
        loading={loading}
        onConfirm={handleArchive}
      />

      {/* Assign Group Dialog */}
      <ModalShell
        open={dialog === 'group'}
        onOpenChange={onOpenChangeFor('group')}
        title="Asignar grupo"
        description={<>Asigna {userName} a un grupo o equipo.</>}
        actions={
          <>
            {cancelButton}
            <SaveButton label="Guardar" loading={loading} onClick={handleGroupChange} />
          </>
        }
      >
        <div className="space-y-4">
          <Select
            value={selectedGroup || NO_GROUP_VALUE}
            onValueChange={(v) => setSelectedGroup(v ?? NO_GROUP_VALUE)}
          >
            <SelectTrigger className="w-full" aria-label="Grupo">
              {/* Con hijos propios el disparador no enseña el identificador crudo. */}
              <SelectValue>
                {!selectedGroup || selectedGroup === NO_GROUP_VALUE
                  ? 'Sin grupo'
                  : formatGroupLabel(selectedGroup, groups)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_GROUP_VALUE}>Sin grupo</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {formatGroupDisplayName(g)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ActionError message={error} />
        </div>
      </ModalShell>

      {/* Activate from Rejected Dialog */}
      <ModalShell
        open={dialog === 'activate-rejected'}
        onOpenChange={onOpenChangeFor('activate-rejected')}
        title="Activar usuario rechazado"
        description={<>Asigna un rol a {userName} para activar su acceso.</>}
        actions={
          <>
            {cancelButton}
            <SaveButton
              label="Activar acceso"
              loading={loading}
              disabled={!selectedRole}
              onClick={handleActivateFromRejected}
            />
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel className="block leading-none">
              Rol <span className="text-destructive">*</span>
            </FieldLabel>
            <RoleSelect roles={roles} value={selectedRole} onChange={setSelectedRole} />
          </div>
          <div className="space-y-1.5">
            <FieldLabel className="block leading-none">
              Jefe directo <span className="text-xs text-muted-foreground">(opcional)</span>
            </FieldLabel>
            <ManagerSelect
              managers={possibleManagers}
              value={selectedManager}
              onChange={setSelectedManager}
              placeholder="Sin jefe directo"
            />
          </div>
          <ActionError message={error} />
        </div>
      </ModalShell>
    </>
  );
}

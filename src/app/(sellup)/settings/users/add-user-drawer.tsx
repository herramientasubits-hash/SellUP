'use client';

import { useState } from 'react';
import { UserPlus, Mail, CheckCircle2, XCircle, ChevronDown, User, KeyRound, Network, Loader2 } from "@/icons";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel, FieldError } from '@/components/forms/field';
import { Textarea } from '@/components/ui/textarea';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { DrawerSection } from '@/components/shared/drawer-section';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { createPreapproval } from '@/modules/access/actions';
import type { Role, InternalUser, OrganizationGroup } from '@/modules/access/types';
import { UserAvatar } from './user-avatar';

const NO_MANAGER = '__none__';
const NO_GROUP = '__none__';

interface AddUserDrawerProps {
  roles: Role[];
  activeUsers: InternalUser[];
  groups: OrganizationGroup[];
  /**
   * Modo controlado: quien lo monta decide cuándo está abierto (la barra de
   * acciones de la pantalla) y el drawer no pinta su propio botón.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AddUserDrawer({
  roles,
  activeUsers,
  groups,
  open: controlledOpen,
  onOpenChange,
}: AddUserDrawerProps) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [notes, setNotes] = useState('');

  const emailTouched = email.length > 0;
  const emailValid = email.endsWith('@ubits.co') && email.length > 10;

  const selectedRole = roles.find(r => r.id === roleId);
  const selectedManager = activeUsers.find(u => u.id === managerId);
  const selectedGroup = groups.find(g => g.id === groupId);

  const sortedGroups = [...groups].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.name.localeCompare(b.name);
  });

  function reset() {
    setEmail(''); setFullName(''); setRoleId('');
    setManagerId(''); setGroupId(''); setNotes('');
    setError(null);
  }

  async function handleSubmit() {
    if (!emailValid || !roleId) return;
    setLoading(true);
    setError(null);

    const result = await createPreapproval({
      email: email.trim().toLowerCase(),
      full_name: fullName.trim() || null,
      role_id: roleId,
      manager_id: managerId && managerId !== NO_MANAGER ? managerId : null,
      group_id: groupId && groupId !== NO_GROUP ? groupId : null,
      notes: notes.trim() || null,
    });

    setLoading(false);

    if (!result.success) {
      setError(result.error ?? 'Error desconocido');
      return;
    }

    reset();
    setOpen(false);
    window.location.reload();
  }

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}
      trigger={
        isControlled ? undefined : (
          <Button size="sm" onClick={() => setOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" />
            Agregar usuario
          </Button>
        )
      }
      title="Agregar usuario"
      description="Preautoriza un correo @ubits.co. El acceso se activa en el primer inicio de sesión con Google."
      icon={<User className="h-4 w-4" />}
      size="lg"
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => { setOpen(false); reset(); }}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!emailValid || !roleId || loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            {loading ? 'Preautorizando...' : 'Preautorizar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Identity preview */}
        {/* Agrupa datos, no es una tarjeta: fondo sutil y sin borde. */}
        <div className="flex items-center gap-4 rounded-xl bg-surface-subtle px-4 py-3">
          <UserAvatar name={fullName} email={email || 'NN'} size="xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {fullName.trim() || <span className="text-muted-foreground italic">Nombre completo</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {email || <span className="italic">correo@ubits.co</span>}
            </p>
            {selectedRole && (
              <Badge variant="brand" className="mt-1">
                {selectedRole.name}
              </Badge>
            )}
          </div>
        </div>

        {/* ── Section: Identidad ────────────────────────── */}
        <DrawerSection title="Identidad" icon={User} contentClassName="space-y-4">

          {/* Email */}
          <div className="space-y-1.5">
            <FieldLabel htmlFor="au-email" className="block leading-none">
              Correo corporativo <span className="text-destructive">*</span>
            </FieldLabel>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                id="au-email"
                type="email"
                placeholder="nombre.apellido@ubits.co"
                value={email}
                onChange={e => setEmail(e.target.value)}
                aria-invalid={emailTouched && !emailValid ? true : undefined}
                aria-describedby={emailTouched && !emailValid ? 'au-email-error' : undefined}
                className="pl-9 pr-9"
              />
              {emailTouched && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  {emailValid
                    ? <CheckCircle2 className="h-4 w-4 text-success" />
                    : <XCircle className="h-4 w-4 text-destructive" />
                  }
                </span>
              )}
            </div>
            {emailTouched && !emailValid && (
              <FieldError id="au-email-error">Debe terminar en @ubits.co</FieldError>
            )}
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <FieldLabel htmlFor="au-name" className="block leading-none">
              Nombre completo <span className="text-xs text-muted-foreground">(opcional)</span>
            </FieldLabel>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                id="au-name"
                placeholder="Nombre Apellido"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </DrawerSection>

        {/* ── Section: Acceso ───────────────────────────── */}
        <DrawerSection title="Acceso" icon={KeyRound} contentClassName="space-y-4">

          {/* Role */}
          <div className="space-y-1.5">
            <FieldLabel className="block leading-none">
              Rol base <span className="text-destructive">*</span>
            </FieldLabel>
            <Select value={roleId || undefined} onValueChange={v => setRoleId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Seleccionar rol" />
              </SelectTrigger>
              <SelectContent>
                {roles.map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    <div className="flex flex-col py-0.5">
                      <span className="font-medium">{r.name}</span>
                      {r.description && (
                        <span className="text-xs text-muted-foreground leading-tight">{r.description}</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Manager */}
          <div className="space-y-1.5">
            <FieldLabel className="block leading-none">
              Líder inmediato <span className="text-xs text-muted-foreground">(opcional)</span>
            </FieldLabel>
            <Select value={managerId || undefined} onValueChange={v => setManagerId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sin líder asignado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_MANAGER}>Sin líder asignado</SelectItem>
                {activeUsers.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name ?? u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedManager && (
              <div className="flex items-center gap-2 rounded-lg bg-surface-subtle px-3 py-2">
                <UserAvatar name={selectedManager.full_name} email={selectedManager.email} size="xs" />
                <span className="min-w-0 truncate text-xs text-foreground">{selectedManager.full_name ?? selectedManager.email}</span>
              </div>
            )}
          </div>
        </DrawerSection>

        {/* ── Section: Organización ─────────────────────── */}
        <DrawerSection title="Organización" icon={Network} contentClassName="space-y-4">

          <div className="space-y-1.5">
            <FieldLabel className="block leading-none">
              Grupo <span className="text-xs text-muted-foreground">(opcional)</span>
            </FieldLabel>
            <Select value={groupId || undefined} onValueChange={v => setGroupId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sin grupo asignado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>Sin grupo asignado</SelectItem>
                {sortedGroups.map(g => (
                  <SelectItem key={g.id} value={g.id}>
                    {'  '.repeat(g.depth)}{g.depth > 0 ? '· ' : ''}{g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedGroup && (
              <p className="text-xs text-muted-foreground px-1">
                <ChevronDown className="inline h-3 w-3 mr-0.5 -mt-0.5" />
                Nivel {selectedGroup.depth + 1}
                {selectedGroup.parent_group_id && ' · subgrupo'}
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <FieldLabel htmlFor="au-notes" className="block leading-none">
              Notas internas <span className="text-xs text-muted-foreground">(opcional)</span>
            </FieldLabel>
            <Textarea
              id="au-notes"
              placeholder="Contexto de la preautorización, área, fecha de ingreso..."
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="resize-none"
            />
          </div>
        </DrawerSection>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </DrawerShell>
  );
}

'use client';

import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { ModalShell } from '@/components/shared/modal-shell';
import { FieldLabel, FieldDescription } from '@/components/forms/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createOrganizationGroup } from '@/modules/access/actions';
import type { OrganizationGroup } from '@/modules/access/types';

const NO_PARENT = '__root__';

interface ActionButtonsProps {
  groups: OrganizationGroup[];
}

export function ActionButtons({ groups }: ActionButtonsProps) {
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validParents = groups.filter(g => g.depth < 2);

  function reset() {
    setName('');
    setParentId('');
    setError(null);
  }

  async function handleCreateGroup() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);

    const result = await createOrganizationGroup({
      name: name.trim(),
      description: null,
      parent_group_id: parentId && parentId !== NO_PARENT ? parentId : null,
    });

    setLoading(false);

    if (!result.success) {
      setError(result.error ?? 'Error desconocido');
      return;
    }

    reset();
    setShowGroupDialog(false);
    window.location.reload();
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setShowGroupDialog(true)}
      >
        <Plus />
        Agregar grupo
      </Button>

      <ModalShell
        open={showGroupDialog}
        onOpenChange={v => { setShowGroupDialog(v); if (!v) reset(); }}
        title="Crear grupo organizacional"
        description="Define un nuevo grupo o subgrupo. Máximo 3 niveles de profundidad."
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => { setShowGroupDialog(false); reset(); }}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleCreateGroup} disabled={!name.trim() || loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Creando...' : 'Crear grupo'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="cg-name" className="block leading-none">
              Nombre del grupo <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              id="cg-name"
              placeholder="Ej: Colombia, Manufactura, Textiles..."
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel className="block leading-none">Grupo padre <span className="text-xs text-muted-foreground">(opcional)</span></FieldLabel>
            <Select value={parentId || undefined} onValueChange={v => setParentId(v ?? '')}>
              <SelectTrigger className="w-full" aria-label="Grupo padre">
                <SelectValue placeholder="Ninguno (grupo raíz)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>Ninguno (grupo raíz)</SelectItem>
                {validParents.map(g => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.depth === 0 ? g.name : `  · ${g.name}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {parentId && parentId !== NO_PARENT && (
              <FieldDescription>
                Nivel: {((groups.find(g => g.id === parentId)?.depth ?? -1) + 2)}
              </FieldDescription>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </ModalShell>
    </>
  );
}
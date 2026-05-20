'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
        className="gap-2 h-9 text-xs font-medium"
        onClick={() => setShowGroupDialog(true)}
      >
        <Plus className="h-3.5 w-3.5" />
        Agregar grupo
      </Button>

      <Dialog open={showGroupDialog} onOpenChange={v => { setShowGroupDialog(v); if (!v) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear grupo organizacional</DialogTitle>
            <DialogDescription>
              Define un nuevo grupo o subgrupo. Máximo 3 niveles de profundidad.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="cg-name">
                Nombre del grupo <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cg-name"
                placeholder="Ej: Colombia, Manufactura, Textiles..."
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Grupo padre <span className="text-xs text-muted-foreground">(opcional)</span></Label>
              <Select value={parentId || undefined} onValueChange={v => setParentId(v ?? '')}>
                <SelectTrigger className="w-full">
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
                <p className="text-xs text-muted-foreground">
                  Nivel: {((groups.find(g => g.id === parentId)?.depth ?? -1) + 2)}
                </p>
              )}
            </div>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive border border-destructive/20">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowGroupDialog(false); reset(); }}>
              Cancelar
            </Button>
            <Button onClick={handleCreateGroup} disabled={!name.trim() || loading}>
              {loading ? 'Creando...' : 'Crear grupo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
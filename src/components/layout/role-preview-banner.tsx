"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, RotateCcw } from "@/icons";
import { Button } from "@/components/ui/button";
import { roleLabelFor } from "@/modules/access/role-labels";
import { stopRolePreview } from "@/modules/access/role-preview-actions";
import type { RolePreviewState } from "@/modules/access/role-preview";

/** Aviso fijo mientras se mira como otro rol, con la salida a mano. */
export function RolePreviewBanner({ active }: { active: NonNullable<RolePreviewState["active"]> }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const leave = () =>
    startTransition(async () => {
      await stopRolePreview();
      router.refresh();
    });

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warning/40 bg-warning/15 px-4 py-1.5 text-xs text-foreground"
    >
      <Eye className="size-4 shrink-0" aria-hidden="true" />
      <span>
        Estás viendo SellUp como <strong className="font-semibold">{roleLabelFor(active.roleKey)}</strong> ·{" "}
        {active.asName}. Lo que hagas queda a tu nombre.
      </span>
      <Button size="xs" variant="outline" onClick={leave} disabled={pending}>
        <RotateCcw aria-hidden="true" />
        Volver a Administrador
      </Button>
    </div>
  );
}

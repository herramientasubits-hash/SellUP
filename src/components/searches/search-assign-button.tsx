"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "@/icons";
import { Button } from "@/components/ui/button";
import type { AssignableUser } from "@/components/assignment/assign-owner-drawer";
import { BulkSearchAssignDrawer } from "@/components/prospect-batches/bulk-search/bulk-search-assign-drawer";
import { getSearchPendingCandidatesAction } from "@/modules/prospect-batches/searches/search-assign-actions";

/**
 * «Asignar a…» sobre la búsqueda entera (dueña 28-10): las empresas que siguen por
 * revisar pasan a una persona o se reparten entre varias. Es el mismo reparto que en
 * Empresas › Búsquedas y en la búsqueda masiva.
 */
export function SearchAssignButton({
  searchId,
  searchName,
  users,
}: {
  searchId: string;
  searchName: string;
  users: AssignableUser[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden="true" />
        Asignar a…
      </Button>
      {open && (
        <BulkSearchAssignDrawer
          open
          onOpenChange={setOpen}
          loadCandidates={() => getSearchPendingCandidatesAction([searchId])}
          label={searchName}
          users={users}
          onAssigned={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

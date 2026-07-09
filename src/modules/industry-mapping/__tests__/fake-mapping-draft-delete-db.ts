// fake-mapping-draft-delete-db.ts — Injectable in-memory fake for
// MappingDraftDeleteDbClient. No Supabase, no network. Mirrors only the exact
// shape the delete-DRAFT domain service actually calls: .rpc(). Records every
// call for call-count/argument assertions (DD-1 through DD-14).

import type {
  MappingDraftDeleteDbClient,
  MappingDraftDeleteRpcResult,
} from '../mapping-draft-delete-service';

export type FakeDeleteRpcHandler = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<MappingDraftDeleteRpcResult> | MappingDraftDeleteRpcResult;

export interface FakeDeleteRpcCall {
  fn: string;
  params: Record<string, unknown>;
}

export function makeFakeMappingDraftDeleteDb(rpcHandler: FakeDeleteRpcHandler): {
  db: MappingDraftDeleteDbClient;
  calls: FakeDeleteRpcCall[];
} {
  const calls: FakeDeleteRpcCall[] = [];
  const db: MappingDraftDeleteDbClient = {
    async rpc(fn: string, params: Record<string, unknown>): Promise<MappingDraftDeleteRpcResult> {
      calls.push({ fn, params });
      return rpcHandler(fn, params);
    },
  };
  return { db, calls };
}

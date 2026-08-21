/**
 * BR Receita CNPJ — NATIONAL SOURCE PASS MULTIPLIER (BR-SOURCE-14B.0M correctness patch).
 *
 * Shared derivation used by both the byte-volume preflight
 * (`br-receita-cnpj-14b0m-national-multipart-size-preflight.ts`) and the cumulative source-file-open
 * preflight (`br-receita-cnpj-14b0m-cumulative-source-open-preflight.ts`): in the worst case the
 * engine's own code permits, how many times does a full national join traverse every source
 * descriptor from end to end?
 *
 * `br-receita-cnpj-full-join-engine.ts` § 6.2 (`mayRepartition`) discards the coarser partition map
 * and restarts the ENTIRE stage-2 reference pass from source whenever a partition overflows and
 * `partitionDepth + 1 <= maxPartitionDepth`. So the reference pass may run end to end
 * `maxPartitionDepth + 1` times in total — the initial pass, plus one full retry per permitted depth.
 * Stage 3's partitioned join then adds exactly one further descriptor-wide pass worth of work — a
 * byte refetch per spilled reference, or (per descriptor) a join-time handle open — never more,
 * because a given row/ordinal is only ever revisited once during that stage.
 *
 * `(maxPartitionDepth + 1)` reference passes + `1` join-stage pass = `maxPartitionDepth + 2`.
 *
 * Returns `null` — never an optimistic guess — when `maxPartitionDepth` is not a valid non-negative
 * integer. A caller that cannot derive the multiplier for its configuration must report
 * `indeterminate`, never fall back to a fixed number that happened to be right for today's caps.
 */
export function deriveBrazilReceitaNationalMultipartSourcePassMultiplier(
  maxPartitionDepth: number,
): number | null {
  if (!Number.isInteger(maxPartitionDepth) || maxPartitionDepth < 0) return null;
  return maxPartitionDepth + 2;
}

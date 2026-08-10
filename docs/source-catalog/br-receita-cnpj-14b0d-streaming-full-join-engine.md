# BR-SOURCE-14B.0D — Streaming full-join engine

**Status:** engine delivered and tested against **synthetic fixtures only**.
**Real full-scan benchmark: NOT authorized, NOT executed. GATE-2: NOT approved. No import, no
runtime, no Agent 1, no Supabase, no real manifest, no real dataset file opened.**

**Headline change:** `FULL_JOIN_MODEL` moves from **D** (no executable full-scan route) to **A**
(fully bounded streaming). `FULL_JOIN_IMPLEMENTATION_EXISTS` moves from `false` to `true`.

BR-SOURCE-14B.0C could not audit a full-join runner for unbounded growth, because there was no code
path that processed a whole file. This milestone wrote that code path.

---

## 1. What "Model A" means here, precisely

| Question | Answer |
|---|---|
| `FULL_JOIN_IMPLEMENTATION_EXISTS` | **true** |
| `FULL_JOIN_MODEL` | **A** — fully bounded streaming |
| `FULL_JOIN_READER_REACHES_EOF` | **true** — the loop runs while `position < declaredBytes` |
| `FULL_JOIN_IS_STREAMING` | **true** — one reusable chunk buffer, no whole-file read anywhere |
| `FULL_JOIN_MATERIALIZES_DATASET` | **false** — nothing accumulates across chunks except a capped carry |
| `JOIN_ARCHITECTURE` | external hash-partitioned streaming join over **offset references** |
| `TEMP_REFERENCE_FORMAT` | fixed-width 16-byte binary record: file ordinal, byte offset, byte length, family code |
| `JOIN_INDEX_STRUCTURE` | `Map<normalizedKey, readonly RowReference[]>` for **one partition**, cleared before the next |
| `JOIN_INDEX_MAX_SIZE` | `maxJoinKeysInMemory` (14B.0C cap), re-checked on every insert |
| `JOIN_INDEX_GROWTH_DRIVER` | **the partition map and the cap** — never the dataset |
| `OUTPUT_ROWS_MATERIALIZED` | **zero**. `maxOutputRows: 0`, and a materializing sink breaches on the first match |
| `TEMP_STORAGE_REQUIRED` | **yes** — and still **unapproved** for real data |

### Peak memory, stated completely

Chunk buffer (`maxChunkBytes`, allocated once) + carry buffer (`maxCarryBytes`) + row buffer
(`maxRowBytes`) + one partition's key window (`maxJoinKeysInMemory`) + one reference slice
(256 × 16 bytes). Not one of those terms contains a file length or a row count.

## 2. The three passes

1. **Empresas → EOF.** Parse the join key at column 0, hash it to a partition ordinal, discard the
   key, append an opaque reference.
2. **Estabelecimentos → EOF.** Identically.
3. **Per partition.** Load a bounded Empresas key window by re-reading each row from its recorded
   offset; stream that partition's Estabelecimentos references in bounded slices; re-read, compare in
   memory, hand matches to the sink; clear the window before the next partition.

## 3. What a partition file may contain

Only the 16-byte record above. There is no string field in the codec, so a CNPJ, a CNPJ básico, a
razão social, a raw row, a join key or a hash of one has nowhere to go. The tests read the bytes back
off the disk and search them for the fixtures' own key and filler markers.

File names are technical and sequential: `empresas-part-00001.refs`,
`estabelecimentos-part-00001.refs`. No Receita filename, no identifier, no company value.

## 4. Repartition is not a retry

When a partition would exceed `maxReferencesPerPartition` or
`maxReferenceBytesPerPartition`, the two reference passes are redone at a doubled partition count —
but only when `maxPartitionDepth` allows it, the count stays at or below `maxPartitionCount`,
temporary storage is still under its cap, and **no match has been emitted yet**. Otherwise the run
aborts with `partition_capacity_exceeded`. The limit is never widened after an adverse distribution,
and 14B.0C's automatic retry count remains structurally zero.

## 5. Temporary storage — mechanism built, authorization unchanged

`BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED = false`. A run with `realDataRun: true`
is refused before a destination is even validated.

The mechanism that a future approval would unlock is complete and tested: workspace outside the
repository, outside `$HOME`, outside the dataset root, symlinked parent refused, `realpath` compared
against the declared parent, traversal segments refused, directory `0700` and files `0600` **verified
after creation**, projected byte total checked before every single write, and a deletion engine that
removes only files matching its own technical pattern, has no force flag and no recursion, and
re-checks absence afterwards.

`br-receita-cnpj-full-join-cleanup` remains the pure planner it always was — it cannot report
`completed` because it was written when no deletion engine existed. The engine fills the same report
shape with the outcome that actually happened, and keeps `unverified` distinct from `failed`.

## 6. Benchmark mode

`BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED = false` and
`BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED = false` — unchanged, and pinned by a source-text
test.

`runBrazilReceitaFullJoinSyntheticFixtureBenchmark` is the only executable path: it runs the **real
engine** over synthetic fixtures into `NullBenchmarkSink`, and refuses `realDataRun: true`, a non-zero
`maxOutputRows`, a materializing sink, an unsafe operator working directory, a non-literal no-write
contract, and a second attempt.

`summarizeBrazilReceitaFullJoinBenchmarkReadiness()` now reports
`fullScanBenchmarkReadyForAuthorization: true` and `nextAction: 'merge_review'`. **Ready for
authorization is not authorized.**

## 7. Files

| Module | Purpose |
|---|---|
| `br-receita-cnpj-full-join-streaming-reader.ts` | Bounded sequential reader: advances to EOF, four buffer caps, non-progression abort |
| `br-receita-cnpj-full-join-partition-workspace.ts` | Reference codec, destination safety, storage cap, verified deletion engine |
| `br-receita-cnpj-full-join-engine-contract.ts` | `BoundedJoinedRecord`, sink, partitioning caps, key normalization, partition assignment |
| `br-receita-cnpj-full-join-engine-bookkeeping.ts` | Tallies, source-descriptor validation, and the widening re-check schedule |
| `br-receita-cnpj-full-join-engine-report.ts` | The one-way projection from exact figures to the bucketed public report |
| `br-receita-cnpj-full-join-engine.ts` | The three passes, repartition, 14B.0C enforcement, orchestration |
| `br-receita-cnpj-full-join-engine-fs.ts` | The only module in the engine that imports `node:fs` |
| `br-receita-cnpj-full-join-engine-fixtures.ts` | Synthetic fixtures in the official layout + an independent brute-force oracle |

Every module is under this repository's 800-line ceiling; the re-check schedule widens its interval so
the enforcer's checkpoint list stays O(log rows) rather than O(rows).

11F, 11G, 11H and the 10G/10H bounded join dry-run are **unmodified**. They remain narrower,
separately-authorized carve-outs, and a test asserts each still performs exactly two bounded reads at
position zero.

## 8. What is still NOT true

- GATE-2 (temporary storage envelope) is **not approved**.
- The cap input policy is **not ready for owner review**: `maxRuntimeMs` and `maxPhaseRuntimeMs` still
  have no throughput evidence behind them, because no full scan has ever been measured.
- No real manifest, Empresas file or Estabelecimentos file has been opened.
- No row has been emitted, persisted, imported or written anywhere.

**Next action: MERGE REVIEW — BR-SOURCE-14B.0D.**

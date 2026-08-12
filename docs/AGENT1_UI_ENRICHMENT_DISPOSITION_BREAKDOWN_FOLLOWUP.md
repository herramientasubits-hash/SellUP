# AGENT1-UI-ENRICHMENT-DISPOSITION-BREAKDOWN-1 — seguimiento

> Documento de SEGUIMIENTO. Ningún cambio de este hito
> (`AGENT1-APOLLO-BOOTSTRAP-PURCHASE-GATE-THREADING-1`) toca la contabilidad de la
> UI. Se escribe aquí para que el hueco quede nombrado.

## El hecho

En el lote `74a49b01` conviven **tres contabilidades distintas** sobre las mismas
20 empresas:

| Fuente | Reconcilia | Nota |
|---|---|---|
| `candidate_final_dispositions` | **20/20**, `unclassified_count = 0` | correcta; **nadie la lee** — sólo se escribe |
| `pre_writer_state_consistency` | 15/20, `ok: false` | cuenta los 2 de cap, no los 5 de evidencia insuficiente |
| Desglose de la UI | **13/20** | 7 empresas «sin clasificar» |

Las 7 «sin clasificar» de la UI son, exactamente:

- 5 × `insufficient_evidence_not_enriched_final`
- 2 × `enrichment_budget_exhausted_final`

Clase **A (TERMINAL_EXISTS_UI_MAPPING_MISSING) × 7**. Las clases B, C, D y E son 0:
no falta la disposición terminal, falta el mapeo a la UI.

## Causa

El tipo `NoNewCandidatesCompactBreakdown` **no tiene campo para ninguna disposición
de enrichment**. Las dos que faltan son:

- `insufficient_evidence_not_enriched_final`
- `enrichment_budget_exhausted_final`

## Por qué NO se arregla en este PR

Este PR corrige la causa por la que la corrida no compraba evidencia. Cambiar a la
vez el desglose de la UI mezclaría un cambio de comportamiento del gasto con uno de
presentación, y el segundo se validaría contra cifras que el primero acaba de
mover.

## Alcance del seguimiento

1. Añadir las dos disposiciones al tipo del desglose.
2. Hacer que la UI lea `candidate_final_dispositions`, que ya reconcilia 20/20, en
   vez de mantener una tercera cuenta propia.
3. Cerrar la divergencia de `pre_writer_state_consistency` o declararla como
   métrica de otra cosa.

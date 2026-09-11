# Línea base de certificación de proveedores

**A1-CERTIFICATION-BASELINE § CUT-C.3** · 2026-09-11
**PROVIDER_CALLS = 0 · PROD_WRITES = 0 · MIGRACIONES = 0 · BUDGET_CHANGES = 0**

Objetivo: conservar una corrida de Apollo y una de Lusha de forma que un
proveedor nuevo pueda compararse contra ellas **sin volver a pagar a los dos
anteriores**.

---

## 1. Auditoría: qué se puede persistir HOY

Verificado contra Producción (`lrdruowtadwbdulndlph`) el 2026-09-11, sólo lectura.

### 1.1 Lo que YA existe y sirve

`provider_usage_logs` es la espina dorsal y ya lleva, en columnas de primera clase:

| necesidad | columna | estado |
|---|---|---|
| provider | `provider_key` | ✅ |
| wizard_run_id | `wizard_run_id` | ✅ (migración 100) |
| batch_id | `batch_id` | ✅ |
| request fingerprint | `request_fingerprint` | ✅ |
| credits | `credits_used` | ✅ |
| response metadata | `metadata` (JSONB) | ✅ |
| latency | `duration_ms` | ⚠️ ver 1.3 |
| timestamps | `created_at` | ✅ (sólo inicio) |
| desenlace de corrida | `status`, `error_code` | ✅ |

**La correlación entre piernas ya funciona.** Una corrida real del waterfall
(`wizard_run_id = 294298cdd4fa9c37baf9a33543cb1355`, 2026-09-08) tiene 2 filas de
Apollo y 1 de Lusha bajo el mismo id y el mismo lote. Unir Apollo con Lusha **no
requiere tabla nueva**.

`country`, `macro_industry`, `pages`, `companies seen/rejected`, `dedupe` y las
disposiciones también existen — dentro de `metadata`, o en
`prospect_discarded_dispositions` y `prospect_candidates`.

### 1.2 🔴 El hallazgo central: los dos proveedores no son comparables hoy

Apollo y Lusha publican **dos vocabularios distintos para las mismas preguntas**:

- Apollo → `apollo_benchmark_funnel`, `apollo_pagination`, `apollo_paid_volume`, `country`, `industry`, `round_number`…
- Lusha → `lusha_run_observability` (con su propio `run.branches`)

Y sobre todo:

> **`apollo_benchmark_funnel.accepted_for_target` es `null` en 16 de 16 filas de
> Producción.** Lusha sí publica `accepted_for_target_total`.

Sin ese numerador, **el rendimiento útil y el coste por empresa útil de Apollo no
son calculables** desde su fila de gasto. El propio bloque de Apollo ya declara la
costura:
`target_satisfaction_decided_by_candidate_writer_across_all_queries_not_correlated_back_to_search_usage_row`.

Esto **no se arregla con una migración**: es una costura de correlación entre el
writer de candidatos y la fila de búsqueda. Es el trabajo más caro pendiente y el
que de verdad bloquea una certificación honesta.

### 1.3 Lo que falta, nombrado

| campo | estado | costura |
|---|---|---|
| `certification_run_id` | ❌ **no existe** (0 tablas, 0 columnas) | agrupar varias corridas en una campaña no está escrito en ningún sitio |
| `provider_order` | ⚠️ **derivable** ordenando por `created_at` | frágil: dos filas del mismo instante lo invierten sin avisar |
| `companies_accepted` (Apollo) | ❌ `null` en 16/16 | ver 1.2 |
| `latency_ms` | ⚠️ parcial | 93/93 en `organizations_search`, 8/8 en `company_prospecting_v3`, **0/82 en `organization_enrichment`** |
| `finished_at` | ❌ | sólo se guarda `created_at` |
| `employee_count_known`, `identity_resolved` | ⚠️ | viven en `prospect_candidates`, no en la fila de gasto |
| disposiciones de una corrida sin lote | ❌ | ver 1.4 |

### 1.4 🔴 Las disposiciones de Lusha: 0 filas en Producción

`prospect_discarded_dispositions` tiene 61 filas, **todas de Apollo**. Ninguna de
Lusha, pese a que la trazabilidad se mergeó el 2026-09-08.

Causa (ver CUT-C.2 § G): `batch_id` es `NOT NULL REFERENCES prospect_batches(id)`,
y una corrida **standalone** que rechaza todo no crea lote ⇒ `batchId: null` ⇒ no
se escribe nada. Es el peor caso — **página pagada, nada admitido, cero rastro** —
y es justo el que la certificación más necesita ver.

---

## 2. Diseño

### 2.1 Sin tabla nueva

La línea base es una **proyección**, no un almacén. `src/modules/provider-certification/`
traduce lo que ya existe a un vocabulario único:

- `certification-baseline.ts` — el catálogo de campos y métricas, y la regla
  `observed` / `derived` / `missing` con costuras nombradas (idéntica a la que
  `apollo-benchmark-funnel.ts` ya estableció).
- `usage-log-adapters.ts` — un adaptador por proveedor.

**Añadir un proveedor nuevo = escribir su adaptador.** No hay que volver a correr
—ni pagar— Apollo ni Lusha: sus filas conservadas bastan.

### 2.2 Regla innegociable

Un campo que la corrida no puede producir con verdad se publica `null` y se nombra
en `fields_missing` + `missing_correlation_seams`. **Jamás como 0.**

Un `0` dice «lo medimos y salió cero». Un `null` dice «no lo medimos». Colapsar el
segundo en el primero es lo que hace que una certificación elija el proveedor
equivocado con total confianza.

### 2.3 Métricas

`useful_yield`, `precision` y `cost_per_useful` se calculan cuando sus insumos
existen y devuelven `null` cuando no. `coverage` y `overlap` son propiedades del
**conjunto** de identidades de dos corridas, no de una fila: se declaran en el
catálogo y se calculan fuera, cruzando `prospect_candidates.identity_key`.

---

## 3. Migración mínima propuesta — **NO EJECUTADA**

**MIGRACIONES = 0 en este corte.** Requiere autorización explícita separada.

### 3.1 Alcance mínimo (aditivo, sin reescribir nada)

```sql
-- (a) agrupar corridas en una campaña de certificación
ALTER TABLE provider_usage_logs
  ADD COLUMN IF NOT EXISTS certification_run_id text NULL,
  ADD COLUMN IF NOT EXISTS provider_order       smallint NULL,
  ADD COLUMN IF NOT EXISTS finished_at          timestamptz NULL;

CREATE INDEX IF NOT EXISTS provider_usage_logs_certification_run_idx
  ON provider_usage_logs (certification_run_id, provider_order)
  WHERE certification_run_id IS NOT NULL;

-- (b) que una corrida sin lote no pierda sus descartes (CUT-C.2 § G)
ALTER TABLE prospect_discarded_dispositions
  ALTER COLUMN batch_id DROP NOT NULL;
```

### 3.2 Impacto

| aspecto | impacto |
|---|---|
| Escrituras existentes | **ninguna**: las 3 columnas son nullable y nadie las lee hoy |
| Presupuesto / créditos | **ninguno**: no toca tablas de budget |
| RLS | **sin cambios** |
| Reversibilidad | (a) trivial; (b) **no trivial** — volver a `NOT NULL` exige purgar las filas huérfanas |
| Riesgo real | (b) **rompe la clave de idempotencia**: `UNIQUE (batch_id, source_key)` no distingue filas con `batch_id IS NULL`, así que hay que sustituirla por `UNIQUE (COALESCE(batch_id::text, certification_run_id), source_key)` **en la misma migración**, o una segunda corrida duplicará filas |

### 3.3 Lo que la migración NO arregla

`companies_accepted` de Apollo (§ 1.2). Ninguna columna lo resuelve: hay que
correlacionar la admisión del writer de candidatos con la fila de búsqueda. **Es
el trabajo que de verdad falta para que la certificación sea honesta**, y es
mayor que esta migración.

---

## 4. Recomendación

1. **Antes de gastar un crédito**, cerrar la costura de `accepted_for_target` de
   Apollo. Sin ella, la certificación no puede responder «¿cuál rinde más por
   crédito?» — que es la única pregunta que justifica pagarla.
2. La migración de § 3 puede esperar: `wizard_run_id` ya correlaciona las piernas
   y `provider_order` es derivable. `certification_run_id` sólo hace falta cuando
   haya **varias** campañas que distinguir.
3. El hueco de § 1.4 sí conviene cerrarlo antes de la corrida de certificación: si
   no, la corrida que más enseña —la que no admite nada— no dejará rastro.

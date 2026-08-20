# Agente 2A — Documentación final y handoff

> **Estado:** **CERRADO / HABILITADO EN PRODUCCIÓN.** Funcionalmente terminado y operativo.
> **Presupuesto operativo:** **activo** para Apollo y para Lusha — ver
> [BUDGET_AND_BILLING.md](BUDGET_AND_BILLING.md) § 8.1.
> **Fecha de la auditoría:** 2026-08-19. **Snapshot de presupuesto:** 2026-08-20.
> **Base de la auditoría:** `origin/main` @ `807e9da7` + esquema de Producción leído en modo READ-ONLY.
> **Naturaleza de este documento:** auditoría, documentación y handoff. **No introduce ningún cambio de runtime.**

---

## 1. Qué es el Agente 2A

Agente 2A es el subsistema de **enriquecimiento de contactos decisores de RR.HH.** de SellUp.

Toma una **cuenta** (empresa), busca personas con rol de decisión en RR.HH. a través de
proveedores de datos externos, las materializa como **candidatos** en una cola de revisión
humana, permite **revelar teléfonos pagando créditos**, y —sólo tras una aprobación humana
explícita— las convierte en **contactos oficiales** dentro de SellUp.

Lo que define su arquitectura no es el enriquecimiento en sí, sino tres restricciones que
atraviesan todo el subsistema:

1. **Cada llamada a un proveedor cuesta dinero real.** Por eso nunca se llama a un proveedor
   antes de que exista una reserva de crédito atómica.
2. **Los teléfonos son PII sujeta a DSAR.** Por eso la privacidad se evalúa *fail-closed* y se
   re-evalúa dentro de la transacción de persistencia.
3. **Nada se aprueba solo.** No hay aprobación automática de candidatos ni escritura automática
   en HubSpot.

---

## 2. Índice

| Documento | Contenido |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Diagrama end-to-end, capas, responsabilidades, call graphs |
| [DATA_MODEL.md](DATA_MODEL.md) | Tablas reales, relaciones, lifecycle, staging vs canonical vs ledger |
| [PHONE_REVEAL_AND_SEARCH_MORE.md](PHONE_REVEAL_AND_SEARCH_MORE.md) | Reveal inicial, waterfall Apollo→Lusha, multi-teléfono, «Ver más» y «Buscar más» |
| [PRIVACY_AND_SUPPRESSION.md](PRIVACY_AND_SUPPRESSION.md) | Supresión nativa del proveedor, DSAR, DNC, semántica fail-closed |
| [BUDGET_AND_BILLING.md](BUDGET_AND_BILLING.md) | Modelo presupuestario por proveedor, reservas, liquidación, costo desconocido |
| [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) | Diagnóstico operativo sin exponer PII + auditoría de feature flags |
| [HISTORY_AND_INCIDENTS.md](HISTORY_AND_INCIDENTS.md) | Cronología de PRs, migraciones e incidentes con causa raíz |
| [QA_ACCEPTANCE.md](QA_ACCEPTANCE.md) | Casos reales de aceptación verificados contra Producción |
| [FUTURE_WORK.md](FUTURE_WORK.md) | Lo NO implementado, separando deuda de alcance deliberado |
| [HANDOFF_PROMPT.md](HANDOFF_PROMPT.md) | Prompt copiable para retomar el agente en un chat nuevo |

---

## 3. Resumen ejecutivo por capacidad

### A. Búsqueda / enriquecimiento de contactos

Un *enrichment run* sobre una cuenta consulta **Apollo** (proveedor primario) y, tras el flag
correspondiente, **Lusha** (secundario / challenger). El resultado son filas en
`contact_enrichment_candidates` en estado `pending_review`. Existe también una modalidad
**bulk** por cuenta (`contact_enrichment_bulk_runs`).

### B. Candidate review

Un operador `admin` revisa cada candidato. Los estados terminales del candidato son
`approved`, `rejected`, `discarded`, `archived`; `duplicate` es un desenlace propio con su
propia cola. **Ningún candidato se aprueba automáticamente.**

### C. Phone reveal

Un clic en «Revelar teléfono» autoriza hasta **dos patas de proveedor**: Apollo primero y, sólo
si Apollo termina en `no_phone_found`, Lusha por debajo — sin segundo clic. Toda la autorización
vive en **una** fila de `phone_reveal_waterfall_runs`.

Topes vigentes en código (`phone-reveal-waterfall-core.ts`):

| Constante | Valor |
|---|---|
| `PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS` | 8 |
| `PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS` | 5 |
| `PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA` | 13 |
| `PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS` | 5 |
| `SEARCH_MORE_MAX_CREDITS` | 5 |

### D. Múltiples teléfonos

Desde la migración 109 el candidato tiene una **colección canónica** de teléfonos
(`contact_enrichment_candidate_phones`) con procedencia por número
(`contact_enrichment_candidate_phone_sources`). La migración 114 hace lo mismo para el
contacto **oficial** (`contact_phones` / `contact_phone_sources`).

### E. «Ver más números»

**Sólo lectura.** 0 llamadas a proveedor, 0 créditos, 0 escrituras. Muestra números que ya se
pagaron y ya se guardaron.

### F. «Buscar más números» (Search More)

Operación **pagada** y **Lusha-only**. Consulta al proveedor que al candidato le falta, exige
identidad nativa de Lusha, tope 5 créditos, sin reintento automático. Ver
[PHONE_REVEAL_AND_SEARCH_MORE.md](PHONE_REVEAL_AND_SEARCH_MORE.md) § 6.

### G. Aprobación a contacto oficial

La migración 116 hace la aprobación **atómica**: cuenta, run, contacto, colección de teléfonos
oficial y auditoría en una sola transacción. La 117 añade el *merge* humano-confirmado de un
duplicado sobre un contacto existente.

### H. Privacidad

Supresión **nativa del proveedor** e independiente de la cuenta (migración 120, Fase 1).
Fase 2 (identidad global entre proveedores) está deliberadamente **ausente**.

### I. Presupuesto

Modelo **por proveedor**, nunca un pozo compartido. Reserva atómica antes de cualquier llamada.
Costo no reportado es `unknown`, **nunca 0**.

Las reglas **operativas** de Apollo y de Lusha están **activas** en Producción. El presupuesto
**no** es un interruptor de QA: la disponibilidad de las operaciones pagadas la gobiernan esas
reglas más los gates fail-closed del runtime.

### J. Observabilidad

`provider_usage_logs` es el ledger de gasto; `phone_reveal_waterfall_runs` es el ledger de
autorización; `*_phone_sources` es el ledger de procedencia.

---

## 4. Snapshot de Producción (READ-ONLY, 2026-08-19; presupuesto 2026-08-20)

Proyecto Supabase `lrdruowtadwbdulndlph`, `ACTIVE_HEALTHY`.

| Métrica | Valor |
|---|---|
| Enrichment runs no terminales | 36 (`ready_to_enrich` 17 + `ready_for_review` 19) |
| Enrichment runs terminales | 31 (`completed` 21, `superseded` 9, `failed` 1) |
| Bulk runs | 1 (`completed`) |
| Phone runs no terminales | **0** |
| Phone runs terminales | 4 (`completed_lusha` 2, `completed_apollo` 1, `exhausted` 1) |
| Reservas de crédito activas | **0** (4 `confirmed`, 1 `released`) |
| Filas de teléfono de candidato | 6 (6 vivas, 0 suprimidas) |
| Filas de procedencia de candidato | 6 |
| Filas de teléfono de contacto oficial | 1 |
| Filas de procedencia de contacto oficial | 1 |
| Corridas `search_more` terminales | **2** |
| Corridas `search_more` no terminales | **0** |
| Supresiones nativas registradas | 0 |
| Presupuesto Apollo | **activo** — `global`, mensual, en créditos, `on_exceed = alert` |
| Presupuesto Lusha | **activo** — `role` = `admin`, mensual, en créditos, `on_exceed = block` |
| Reglas Apollo históricas | 3, **inactivas** (`group`, `role`, `user` de QA) |
| Regla Lusha de QA por usuario | 1, **inactiva** |

Cifras de presupuesto del mismo snapshot (**instante, no regla de producto**):

| Proveedor | Techo de la regla vigente | Consumido en el período | Reservado activo | Disponible |
|---|---|---|---|---|
| `apollo` | 500 (`global`) | 298 | 0 | 202 |
| `lusha` | 500 (`role` `admin`) | 16 | 0 | 484 |

> **Consecuencia operativa:** con presupuesto activo para los dos proveedores, tanto el reveal
> normal (`full_waterfall` y su variante `apollo_only`) como «Buscar más números» tienen
> presupuesto **resoluble** bajo la política vigente. Los techos son **configuración
> administrable**, no constantes del producto, y los números de consumo de arriba son un
> **snapshot fechado**.
>
> `budget_not_configured` sigue existiendo como comportamiento *fail-closed* para el caso de que
> una regla se desactive o falte. Su diagnóstico está en
> [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) § E y la política vigente en
> [BUDGET_AND_BILLING.md](BUDGET_AND_BILLING.md) § 8.1.

---

## 5. Discrepancias encontradas entre documentación histórica y realidad

Registradas, **no corregidas**, según el mandato de esta auditoría.

| Discrepancia | Fuente de verdad |
|---|---|
| Las cabeceras de las migraciones 109, 110, 111, 113, 114, 115, 116, 117, 120 y 121 declaran «NOT APPLIED» / «APPLIED IN PRODUCTION: NO». **Todas están aplicadas en Producción.** | `supabase_migrations.schema_migrations` leído en vivo |
| Las cabeceras de 101–104 dicen «LOCAL DRAFT ONLY, not applied to any remote project». Están aplicadas (102 → `20260803231953`, 104 → `20260805010026`). | Idem |
| El comentario de `lusha-phone-fallback-copy.ts` dice que el fallback está «OFF in every environment today». El propio `feature-flags.server.ts` ya corrige esa afirmación y advierte que el valor sólo es legible en runtime. | `feature-flags.server.ts` §`isLushaPhoneRevealFallbackEnabled` |
| El cuerpo del PR #309 afirma «En Producción no hay ninguna regla de crédito activa para Lusha». Hoy **sí la hay**: la autoridad operativa vigente es la regla de **rol `admin`** (mensual, en créditos, `on_exceed = block`). La regla puntual **por usuario** que se usó en la QA quedó **inactiva** y no es política. | `budget_rules` leído en vivo |

---

## 6. Reglas de seguridad para futuros cambios

Los *ratchets* obligatorios están en
[FUTURE_WORK.md](FUTURE_WORK.md) § «Reglas que no se pueden aflojar». Léelos antes de tocar
cualquier archivo de `src/modules/contact-enrichment/`.

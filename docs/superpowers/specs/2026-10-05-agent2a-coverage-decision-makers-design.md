# Diseño — Agente 2A: más contactos por fuente y decisores fuera de RR. HH.

**Fecha:** 2026-10-05
**Hito:** AGENT2A-COVERAGE-DECISION-MAKERS-1
**Rama:** `feat/agent2a-coverage-decision-makers`
**Estado:** Implementado en la rama (commit local, sin PR). Decisiones de negocio tomadas el 2026-10-05 (doc «Agente 2 — Plan unificado de correcciones y mejoras», hallazgos M1 y M2)

## 1. Problema

Revisión de las empresas de septiembre 2026:

1. **Pocos contactos por búsqueda (M1).** Apollo pide 5 resultados por intento (máx. 3 intentos),
   se detiene al llegar a **2** candidatos revisables y completa (people/match) como máximo **3**
   (`src/lib/apollo-guardrails.ts`). Lusha enriquece 5 (`LUSHA_MAX_CANDIDATES_PER_RUN`, tope 10).
2. **Casi solo trae RR. HH. (M2).** Apollo filtra por departamento o títulos de RR. HH.
   (`HR_PERSON_TITLES`); el clasificador ya acepta CEO y gerente general como relevancia media,
   pero la búsqueda casi nunca los trae. Lusha filtra solo `Human Resources` y enriquece los
   primeros N que llegan, sin ordenarlos por cargo (`novelForEnrich.slice(0, maxCandidates)`).

## 2. Decisiones (2026-10-05)

| Tema | Decisión |
| --- | --- |
| Cobertura | Solo se sube el máximo a **5 contactos por fuente** (Apollo y Lusha). No cambia nada más: Lusha sigue entrando solo por `provider_error` o `zero_reviewable_candidates`. |
| Decisores | Se amplía el Agente 2A a decisores fuera de RR. HH.: **CEO y gerente general**. |

## 3. Diseño

### 3.1 Apollo — hasta 5 contactos

| Guardrail | Antes | Después | Costo |
| --- | --- | --- | --- |
| `targetReviewableContacts` (stop-early) | 2 | **5** | — |
| `maxCompletionCandidates` (people/match) | 3 | **5** | ≤ 5 créditos de email por run; `maxCompletionCreditsPerRun` (10) ya lo cubre |
| `maxResultsPerSearchAttempt` (per_page) | 5 | **10** | 0 — People Search no cobra (AGENT2A-APOLLO-PEOPLE-SEARCH-BILLING-TRUTH-1) |
| `maxSearchResultsPerRun` | 15 | **30** | 0 — se mantiene `= maxSearchAttempts × maxResultsPerSearchAttempt` |
| `maxSearchAttempts` | 3 | 3 | — |

Subir el `per_page` es necesario para que un intento pueda traer 5 revisables después del
filtro de relevancia; no tiene costo porque la búsqueda es gratis. El gasto real (people/match)
sube como máximo de 3 a 5 créditos por run.

### 3.2 Apollo — decisores

- Nueva lista `DECISION_MAKER_TITLES` (CEO, Chief Executive Officer, Gerente General, General
  Manager, Director General, Managing Director, Country Manager).
- Los intentos por títulos usan `TARGET_PERSON_TITLES = HR_PERSON_TITLES + DECISION_MAKER_TITLES`
  (Apollo trata `person_titles` como OR). El intento 1 (departamento RR. HH.) no cambia, así que
  RR. HH. sigue teniendo prioridad.
- El clasificador suma `general manager`, `managing director` y `country manager` a
  `MEDIUM_RELEVANCE_KEYWORDS` (CEO, gerente general y director general ya estaban).

### 3.3 Lusha — orden por seniority antes de pagar

- Lusha ya enriquece máximo 5 por defecto: **no cambia el tope**.
- Antes del `slice(0, maxCandidates)`, los candidatos novedosos se ordenan por seniority
  (`jobTitle.seniority` de Prospecting, con el título como respaldo): dueño/fundador/C-level →
  VP → director/head → gerente/manager → senior → resto. El orden es estable.
- El filtro de departamento sigue en `Human Resources` (único valor confirmado en vivo). Pedir
  ejecutivos a Lusha exigiría una segunda llamada de Prospecting (con su costo) y un valor de
  filtro no verificado; queda fuera de este hito (§ 5).

## 4. Criterios de aceptación

- Un run de Apollo con suficientes perfiles deja hasta 5 candidatos revisables y completa
  hasta 5.
- Un CEO o gerente general de la empresa puede llegar como candidato por la ruta de títulos.
- Lusha enriquece primero a los perfiles de mayor seniority.
- Sin migraciones; los tests de guardrails, adaptador de Apollo, clasificador y Lusha pasan.

## 5. Fuera de alcance

- Lusha como complemento cuando Apollo trae menos del objetivo (descartado el 2026-10-05).
- Búsqueda de ejecutivos en Lusha (segunda llamada de Prospecting).
- Cambios de presupuesto en `BUDGET_AND_BILLING.md` más allá del aumento de completion de 3 a 5.

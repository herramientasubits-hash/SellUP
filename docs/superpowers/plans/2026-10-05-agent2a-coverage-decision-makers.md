# Agente 2A — Cobertura y decisores — Plan de implementación

**Spec:** `docs/superpowers/specs/2026-10-05-agent2a-coverage-decision-makers-design.md`
**Track:** AGENT2A · **Rama:** `feat/agent2a-coverage-decision-makers` · **Base:** `origin/main` @ `3cc54592`

- [x] A. Guardrails de Apollo: target 5, completion 5, per_page 10, tope 30 + test de guardrails.
- [x] B. Apollo: `DECISION_MAKER_TITLES` y `TARGET_PERSON_TITLES` en los intentos por títulos + tests del adaptador.
- [x] C. Clasificador: `general manager`, `managing director`, `country manager` como relevancia media + test.
- [x] D. Lusha: `rankContactsBySeniority` (módulo puro) aplicado antes de los dos `slice(0, maxCandidates)` + tests; actualizar el test estático del novelty gate.
- [x] E. Regresión: suites de Agente 2A (guardrails, adaptador, clasificador, Lusha, routing).
- [x] F. Docs: `docs/agent2a/HISTORY_AND_INCIDENTS.md` y `BUDGET_AND_BILLING.md` (completion 3 → 5).

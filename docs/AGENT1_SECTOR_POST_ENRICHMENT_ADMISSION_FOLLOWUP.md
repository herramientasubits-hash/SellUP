# AGENT1-SECTOR-POST-ENRICHMENT-ADMISSION-1 — seguimiento recomendado

> Documento de ALCANCE. No describe código de este PR: describe lo que
> `AGENT1-APOLLO-SECTOR-EVIDENCE-BOOTSTRAP-1` (PR #274) **deja abierto a
> propósito**, para que nadie lea el hito como algo que no es.
>
> **No implementar aquí.**

## Qué queda resuelto después de #274

Un sector sin política en `SECTOR_SIGNAL_TERMS` deja de ser un rechazo terminal
**antes** del enrichment cuando se cumplen las dos condiciones del hito:

1. la corrida está autorizada — cuatro precondiciones OBSERVADAS de la búsqueda
   emitida: búsqueda real, cobertura de consulta completa, versión de catálogo
   coherente, términos resueltos contra el catálogo publicado;
2. el proveedor no declaró **ningún** campo con carga sectorial para ese
   candidato.

Consecuencia: el candidato puede competir por uno de los ≤ 5 enrichments de la
corrida y **adquirir** la clasificación que `mixed_companies/search` no devuelve.

Y, con el § 17 de este PR, lo que ese crédito compra **sobrevive** aunque el
candidato no se persista: la clasificación enriquecida, las evaluaciones de
precisión por subindustria pedida con su evidencia `término@campo(fuente)`, el
estado sectorial posterior y la disposición terminal quedan en
`prospect_batches.metadata.apollo_sector_evidence_bootstrap`.

## Qué NO queda resuelto — el bloqueo funcional que sigue vivo

**Una corrida de un sector sin política sigue persistiendo 0 candidatos.**

La reevaluación posterior al enrichment corre deliberadamente **sin**
autorización de adquisición (`APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED`).
Si el perfil comprado no trae clasificación que una política existente sepa
juzgar, el veredicto vuelve a `sector_not_mapped`, el orquestador marca el
rechazo definitivo y el candidato muere antes del writer. `isEligible` exige
`sector_evidence_confirmed`, y el bootstrap **nunca** produce ese estado.

Dicho en una línea:

> #274 desbloquea la **ADQUISICIÓN** de evidencia. No desbloquea la **ADMISIÓN**.

Esto es correcto para #274 — comprar más descripción no crea la política que
falta, y un estado de bootstrap que confirmara sector sería precisamente el
fail-open que el hito evita. Pero significa que, hasta que exista admisión
post-enrichment, la corrida sirve para **calibrar** Wave 1 y no para **producir**
candidatos en esos sectores.

## El seguimiento: AGENT1-SECTOR-POST-ENRICHMENT-ADMISSION-1

Objetivo: que un candidato cuyo perfil **comprado** trae clasificación suficiente
pueda ser admitido, en vez de morir por ausencia de política sectorial.

Restricciones que el diseño debe respetar, y que no son negociables:

- **Genérico y guiado por catálogo.** Nada de añadir Salud, Banca, Educación o
  Tecnología a mano a `SECTOR_SIGNAL_TERMS`: eso arregla una corrida y deja el
  bloqueo intacto para las demás subindustrias del catálogo activo. La admisión
  debe derivarse del catálogo publicado, igual que la cobertura de consulta.
- **Cero fail-open.** Un sector sin política no puede volverse admisible por el
  hecho de que alguien pidiera ese sector. Pedir «Salud» autoriza a preguntar;
  jamás responde.
- **No toca caps.** ≤ 2 búsquedas, ≤ 5 enrichments, ≤ 25 créditos por corrida.
- **No promueve `confirm_only`.** Las ramas negativas de una regla `confirm_only`
  siguen absteniéndose.
- **La precisión de subindustria sigue siendo la que decide** el objetivo: la
  admisión sectorial no puede convertirse en un atajo que salte Wave 1.

Entrada natural para el diseño: los packs de revisión manual que produce
`scripts/agent1/wave1-run-audit.ts` sobre corridas de bootstrap ya ejecutadas.
Son la evidencia real —clasificación comprada y veredicto por subindustria— con
la que decidir qué admisión es defendible, sin volver a gastar un crédito.

## Estado

`FOLLOW_UP_REQUIRED = true`. No planificado, no autorizado, no implementado.

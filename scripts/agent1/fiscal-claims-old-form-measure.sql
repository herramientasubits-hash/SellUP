-- AUDIT-HARDENING-1 — medición RÁPIDA y de SOLO LECTURA, antes de aplicar la 152:
-- ¿cuántos reclamos fiscales activos tienen pinta de la forma vieja del NIT/RUT/RUC?
--
-- Es una aproximación por la forma de la clave (no sabe si un número de 10 dígitos
-- es un NIT con el dígito pegado o una cédula). La cuenta EXACTA la da el script
-- `recanonicalize-fiscal-claims.ts` en modo simulación, que vuelve a preguntarle a
-- la misma función de identidad del escritor. Sin escrituras: sólo SELECT.

-- 1. Reclamos fiscales activos por país.
SELECT split_part(claim_key, ':', 1) AS pais,
       count(*)                      AS activos
  FROM public.agent1_company_identity_claims
 WHERE claim_type = 'fiscal'
   AND released_at IS NULL
 GROUP BY 1
 ORDER BY 2 DESC;

-- 2. Los que PUEDEN estar en la forma vieja.
SELECT pais, forma_sospechosa, count(*) AS reclamos
  FROM (
    SELECT split_part(claim_key, ':', 1) AS pais,
           CASE
             WHEN split_part(claim_key, ':', 1) = 'CO' AND split_part(claim_key, ':', 2) ~ '^[0-9]{10}$'
               THEN 'CO: 10 dígitos (¿NIT con el DV pegado?)'
             WHEN split_part(claim_key, ':', 1) = 'CL' AND split_part(claim_key, ':', 2) ~ '^[0-9]{8}$'
                  AND split_part(claim_key, ':', 2)::bigint >= 50000000
               THEN 'CL: 8 dígitos de persona jurídica (¿RUT sin DV?)'
             WHEN split_part(claim_key, ':', 1) = 'PY' AND split_part(claim_key, ':', 2) ~ '^80[0-9]{6}$'
               THEN 'PY: RUC 80xxxxxx de 8 dígitos (¿sin DV?)'
           END AS forma_sospechosa
      FROM public.agent1_company_identity_claims
     WHERE claim_type = 'fiscal'
       AND released_at IS NULL
  ) t
 WHERE forma_sospechosa IS NOT NULL
 GROUP BY 1, 2
 ORDER BY 3 DESC;

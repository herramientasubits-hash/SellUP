-- 161 — Descripción del rol «Growth» (dueña 28-10).
--
-- La 158 (ya aplicada en Producción) dejó una descripción larga. La dueña pidió
-- solo: «Equipo de Growth que prospecta masivamente». Cambia ese texto y nada
-- más: ni la clave ni el nombre del rol, ni a quién lo tiene, ni permisos.

UPDATE roles
SET description = 'Equipo de Growth que prospecta masivamente'
WHERE key = 'growth';

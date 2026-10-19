-- DATOS 100 % SINTÉTICOS. Empleados 1-40 = plantilla normal; 41 y 42 y varios eventos = anomalías sembradas.
SET NAMES utf8mb4;

-- Tabla auxiliar de números 0..999 (se elimina al final).
CREATE TABLE _digits (d INT PRIMARY KEY);
INSERT INTO _digits VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9);
CREATE TABLE _seq (n INT PRIMARY KEY);
INSERT INTO _seq SELECT a.d + 10 * b.d + 100 * c.d FROM _digits a, _digits b, _digits c;

-- ---------- Empleados ----------
INSERT INTO employees (id, full_name, national_id, department, bank_account, address, salary, hire_date, created_by)
SELECT n,
  CONCAT(ELT(1 + n % 10, 'Ana','Luis','María','Carlos','Sofía','Jorge','Laura','Andrés','Paula','Diego'), ' ',
         ELT(1 + n % 8, 'Gómez','Pérez','Rodríguez','Martínez','López','Torres','Ramírez','Vargas')),
  CAST(1000000000 + n * 7919 AS CHAR),
  ELT(1 + n % 6, 'Ventas','Operaciones','TI','RRHH','Nómina','Finanzas'),
  CONCAT('CO-', LPAD((n * 104729) % 100000000, 10, '0')),
  CONCAT('Calle ', n, ' # 10-', n),
  2000000 + (n * 137000) % 7000000,
  DATE_ADD(DATE '2023-01-15', INTERVAL (n * 23) % 700 DAY),
  'rrhh1'
FROM _seq WHERE n BETWEEN 1 AND 40;

-- Anomalías de empleados:
--  41: comparte cuenta bancaria con el 7, sin presencia laboral, creado por jperez
--  42: empleado "fantasma" sin dirección ni presencia, creado por jperez
--  12: dado de baja el 30-abr-2026 pero sigue cobrando
INSERT INTO employees (id, full_name, national_id, department, bank_account, address, salary, hire_date, created_by)
SELECT 41, 'Carlos Ruiz', '1099999041', 'Operaciones', bank_account, 'Carrera 5 # 1-1', 3200000, DATE '2026-02-01', 'jperez'
FROM employees WHERE id = 7;
INSERT INTO employees (id, full_name, national_id, department, bank_account, address, salary, hire_date, created_by)
VALUES (42, 'Marta Inexistente', '1099999042', 'Finanzas', 'CO-0000042042', NULL, 3500000, DATE '2026-02-01', 'jperez');
UPDATE employees SET termination_date = DATE '2026-04-30' WHERE id = 12;

-- ---------- Pagos mensuales ene-sep 2026 ----------
INSERT INTO payroll_payments (employee_id, period, gross, net, bank_account, paid_at)
SELECT e.id,
       DATE_ADD(DATE '2026-01-01', INTERVAL s.n MONTH),
       e.salary, ROUND(e.salary * 0.8, 2), e.bank_account,
       TIMESTAMP(DATE_ADD(DATE_ADD(DATE '2026-01-01', INTERVAL s.n MONTH), INTERVAL 27 DAY), '10:00:00')
FROM employees e JOIN _seq s ON s.n BETWEEN 0 AND 8
WHERE DATE_ADD(DATE '2026-01-01', INTERVAL s.n MONTH) >= DATE_FORMAT(e.hire_date, '%Y-%m-01');

-- pago duplicado (emp. 5, junio)
INSERT INTO payroll_payments (employee_id, period, gross, net, bank_account, paid_at)
SELECT employee_id, period, gross, net, bank_account, DATE_ADD(paid_at, INTERVAL 1 HOUR)
FROM payroll_payments WHERE employee_id = 5 AND period = DATE '2026-06-01';
-- pago a otra cuenta (emp. 19, septiembre)
UPDATE payroll_payments SET bank_account = 'CO-9999999999' WHERE employee_id = 19 AND period = DATE '2026-09-01';
-- el empleado 7 cobra el aumento indebido
UPDATE payroll_payments SET gross = 9500000, net = 7600000 WHERE employee_id = 7 AND period >= DATE '2026-08-01';

-- ---------- Presencia laboral (lun-vie ~08:00); nadie del 41 ni 42 ----------
INSERT INTO attendance (employee_id, ts)
SELECT e.id, TIMESTAMP(DATE_ADD(DATE '2026-01-01', INTERVAL s.n DAY), SEC_TO_TIME(8 * 3600 + (e.id % 30) * 60))
FROM employees e JOIN _seq s ON s.n BETWEEN 0 AND 272
WHERE e.id <= 40
  AND WEEKDAY(DATE_ADD(DATE '2026-01-01', INTERVAL s.n DAY)) < 5
  AND DATE_ADD(DATE '2026-01-01', INTERVAL s.n DAY) >= e.hire_date
  AND (e.termination_date IS NULL OR DATE_ADD(DATE '2026-01-01', INTERVAL s.n DAY) <= e.termination_date);

-- ---------- Auditoría ----------
-- Cambios normales: aumentos del ~7 % hechos por mlopez, aprobados por hr_manager, martes 10:30.
INSERT INTO audit_log (ts, actor, action, table_name, record_id, field, old_value, new_value, approved_by)
SELECT TIMESTAMP(DATE_ADD(DATE '2026-02-10', INTERVAL n * 14 DAY), '10:30:00'),
       'mlopez', 'UPDATE', 'employees', id, 'salary', CAST(salary AS CHAR), CAST(ROUND(salary * 1.07) AS CHAR), 'hr_manager'
FROM (SELECT id, salary, ROW_NUMBER() OVER (ORDER BY id) AS n FROM employees WHERE id IN (2,4,9,15,21,26,31,36)) s;

-- Anomalías (actor jperez, del área de Nómina):
INSERT INTO audit_log (ts, actor, action, table_name, record_id, field, old_value, new_value, approved_by) VALUES
 ('2026-01-31 22:15:00', 'jperez', 'INSERT', 'employees', 41, NULL, NULL, 'Carlos Ruiz', NULL),
 ('2026-01-31 22:20:00', 'jperez', 'INSERT', 'employees', 42, NULL, NULL, 'Marta Inexistente', NULL),
 ('2026-03-04 11:00:00', 'jperez', 'UPDATE', 'employees', 42, 'salary', '0', '3500000', 'jperez'),   -- autoaprobado
 ('2026-07-18 23:40:00', 'jperez', 'UPDATE', 'employees', 7, 'salary', (SELECT CAST(salary AS CHAR) FROM employees WHERE id = 7), '9500000', NULL),  -- sábado de noche, ×3,2, sin aprobación
 ('2026-08-29 02:10:00', 'jperez', 'UPDATE', 'employees', 19, 'bank_account', (SELECT bank_account FROM employees WHERE id = 19), 'CO-9999999999', NULL);

-- ---------- Acceso a expedientes ----------
-- Normal: RRHH y Nómina, lun-vie 09:00-17:00.
INSERT INTO file_access (ts, user_name, user_department, employee_id, doc_type, action, ip)
SELECT TIMESTAMP(DATE_ADD(DATE '2026-02-02', INTERVAL (g DIV 5) * 7 + (g % 5) DAY), SEC_TO_TIME(9 * 3600 + ((g * 7) % 480) * 60)),
       IF(g % 2 = 0, 'rrhh1', 'mlopez'),
       IF(g % 2 = 0, 'RRHH', 'Nómina'),
       1 + g % 40,
       ELT(1 + g % 3, 'contrato', 'recibo', 'certificado'),
       IF(g % 10 = 0, 'download', 'view'),
       CONCAT('10.0.0.', 10 + g % 5)
FROM (SELECT n AS g FROM _seq WHERE n BETWEEN 1 AND 120) x;

-- Anomalía 1: usuario de Ventas mirando contratos ajenos.
INSERT INTO file_access (ts, user_name, user_department, employee_id, doc_type, action, ip)
SELECT DATE_ADD(TIMESTAMP '2026-06-09 15:00:00', INTERVAL n * 2 MINUTE), 'fgomez', 'Ventas', n, 'contrato', 'view', '10.0.0.77'
FROM _seq WHERE n BETWEEN 1 AND 12;
-- Anomalía 2: descarga masiva de recibos, viernes 22:00, IP externa.
INSERT INTO file_access (ts, user_name, user_department, employee_id, doc_type, action, ip)
SELECT DATE_ADD(TIMESTAMP '2026-08-14 22:00:00', INTERVAL n MINUTE), 'jperez', 'Nómina', n, 'recibo', 'download', '203.0.113.50'
FROM _seq WHERE n BETWEEN 1 AND 40;
-- Anomalía 3: accesos nocturnos de mlopez.
INSERT INTO file_access (ts, user_name, user_department, employee_id, doc_type, action, ip)
SELECT DATE_ADD(TIMESTAMP '2026-05-20 21:30:00', INTERVAL n * 3 MINUTE), 'mlopez', 'Nómina', 20 + n, 'contrato', 'view', '10.0.0.12'
FROM _seq WHERE n BETWEEN 1 AND 3;

DROP TABLE _seq;
DROP TABLE _digits;

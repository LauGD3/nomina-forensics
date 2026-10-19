-- Esquema mínimo de nómina y RR. HH. (MySQL 8).
-- Las fechas/horas son DATETIME "hora de pared" (hora local de la empresa), sin zonas horarias.
SET NAMES utf8mb4;

CREATE TABLE employees (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  full_name        VARCHAR(120)  NOT NULL,
  national_id      VARCHAR(30)   NOT NULL UNIQUE,
  department       VARCHAR(60)   NOT NULL,
  bank_account     VARCHAR(40)   NOT NULL,
  address          VARCHAR(200)  NULL,
  salary           DECIMAL(12,2) NOT NULL,
  hire_date        DATE          NOT NULL,
  termination_date DATE          NULL,
  created_by       VARCHAR(60)   NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Un pago por empleado y período (period = primer día del mes).
CREATE TABLE payroll_payments (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  employee_id  INT           NOT NULL,
  period       DATE          NOT NULL,
  gross        DECIMAL(12,2) NOT NULL,
  net          DECIMAL(12,2) NOT NULL,
  bank_account VARCHAR(40)   NOT NULL,   -- cuenta a la que realmente se pagó
  paid_at      DATETIME      NOT NULL,
  INDEX idx_pay_emp_period (employee_id, period),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Auditoría de cambios de datos (quién, qué, cuándo, quién aprobó).
CREATE TABLE audit_log (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  ts          DATETIME     NOT NULL,
  actor       VARCHAR(60)  NOT NULL,
  action      VARCHAR(20)  NOT NULL,     -- INSERT | UPDATE | DELETE
  table_name  VARCHAR(60)  NOT NULL,
  record_id   INT          NOT NULL,
  field       VARCHAR(60)  NULL,
  old_value   VARCHAR(255) NULL,
  new_value   VARCHAR(255) NULL,
  approved_by VARCHAR(60)  NULL,
  INDEX idx_audit_ts (ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Presencia laboral (biometría / inicio de sesión corporativo).
CREATE TABLE attendance (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT      NOT NULL,
  ts          DATETIME NOT NULL,
  INDEX idx_att_emp (employee_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Acceso a expedientes de empleados (contratos, recibos, certificados).
CREATE TABLE file_access (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  ts              DATETIME    NOT NULL,
  user_name       VARCHAR(60) NOT NULL,
  user_department VARCHAR(60) NOT NULL,
  employee_id     INT         NOT NULL,
  doc_type        VARCHAR(40) NOT NULL,
  action          VARCHAR(20) NOT NULL,   -- view | download
  ip              VARCHAR(45) NULL,
  INDEX idx_fa_user_ts (user_name, ts),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

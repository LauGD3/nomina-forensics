import { SQL } from 'bun';

export const DATABASE_URL = process.env.DATABASE_URL ?? 'mysql://forense:forense@localhost:3307/nomina';
export const sql = new SQL(DATABASE_URL);

/** Tablas que la interfaz puede explorar y a las que puede agregar datos (lista blanca). */
export const TABLES = ['employees', 'payroll_payments', 'audit_log', 'attendance', 'file_access'] as const;

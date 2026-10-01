// Database layer — node:sqlite (zero external deps). Real schema, tenant-scoped queries.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hashPassword } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'sable.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    vendor TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | cleared | flagged
    flagged INTEGER NOT NULL DEFAULT 0,
    flag_reason TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    user_id INTEGER,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tx_company ON transactions(company_id);
`);

// ---- Company / user ----
export function createCompany(name) {
  return db.prepare('INSERT INTO companies(name) VALUES (?)').run(name).lastInsertRowid;
}
export function createUser({ companyId, email, password, name, role = 'member' }) {
  const { hash, salt } = hashPassword(password);
  const info = db.prepare(
    'INSERT INTO users(company_id,email,password_hash,salt,name,role) VALUES (?,?,?,?,?,?)'
  ).run(companyId, email.toLowerCase(), hash, salt, name, role);
  return getUserById(info.lastInsertRowid);
}
export const getUserByEmail = (email) =>
  db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
export const getUserById = (id) =>
  db.prepare('SELECT id,company_id,email,name,role,created_at FROM users WHERE id = ?').get(id);
export const getCompany = (id) =>
  db.prepare('SELECT id,name,created_at FROM companies WHERE id = ?').get(id);
export function updateUserProfile(id, name) {
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).slice(0, 80), id);
  return getUserById(id);
}
export function updateCompanyName(companyId, name) {
  db.prepare('UPDATE companies SET name = ? WHERE id = ?').run(String(name).slice(0, 80), companyId);
  return getCompany(companyId);
}
export const countTeam = (companyId) =>
  db.prepare('SELECT COUNT(*) AS n FROM users WHERE company_id = ?').get(companyId).n;

// ---- Transactions (ALWAYS tenant-scoped by companyId) ----
export const listTransactions = (companyId) =>
  db.prepare('SELECT * FROM transactions WHERE company_id = ? ORDER BY occurred_at DESC, id DESC').all(companyId);
export const getTransaction = (companyId, id) =>
  db.prepare('SELECT * FROM transactions WHERE company_id = ? AND id = ?').get(companyId, id);
export function insertTransaction(companyId, userId, { vendor, amount, category, occurred_at, status, flagged, flag_reason }) {
  const info = db.prepare(`INSERT INTO transactions
    (company_id,vendor,amount,category,occurred_at,status,flagged,flag_reason,created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    companyId, vendor, amount, category || 'General',
    occurred_at || new Date().toISOString(), status, flagged ? 1 : 0, flag_reason || null, userId
  );
  return getTransaction(companyId, info.lastInsertRowid);
}
export function updateTransactionStatus(companyId, id, status) {
  const flagged = status === 'flagged' ? 1 : 0;
  db.prepare('UPDATE transactions SET status = ?, flagged = ? WHERE company_id = ? AND id = ?')
    .run(status, flagged, companyId, id);
  return getTransaction(companyId, id);
}
export const deleteTransaction = (companyId, id) =>
  db.prepare('DELETE FROM transactions WHERE company_id = ? AND id = ?').run(companyId, id).changes;

// ---- Audit ----
export const logAudit = (companyId, userId, action, detail) =>
  db.prepare('INSERT INTO audit_log(company_id,user_id,action,detail) VALUES (?,?,?,?)')
    .run(companyId, userId, action, detail || null);
export const listAudit = (companyId, limit = 20) =>
  db.prepare('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.company_id = ? ORDER BY a.id DESC LIMIT ?').all(companyId, limit);

// ---- Seed a demo tenant. Returns {companyId, userId} on first run, else null. ----
// Transaction seeding runs in server.js so it shares the same anomaly path as the API.
export function seedDemoTenant() {
  if (getUserByEmail('demo@sable.io')) return null;
  const companyId = createCompany('Northwind (Demo)');
  const user = createUser({ companyId, email: 'demo@sable.io', password: 'demo1234', name: 'Amara Reid', role: 'admin' });
  return { companyId, userId: user.id };
}

export const SEED_TRANSACTIONS = [
  // vendor, amount, category, daysAgo
  ['Amazon Web Services', 8420.55, 'Cloud', 2],
  ['Gusto Payroll', 141200.00, 'Payroll', 0],
  ['WeWork', 6200.00, 'Facilities', 5],
  ['Stripe Fees', 2310.42, 'Fees', 1],
  ['Meridian LLC', 48000.00, 'Vendor', 3],
  ['Meridian LLC', 48000.00, 'Vendor', 3],   // duplicate -> flags
  ['Figma', 144.00, 'Software', 7],
  ['Northwind Travel', 985.20, 'Travel', 9],
  ['Kestrel Holdings', 99000.00, 'Vendor', 1], // large outlier -> flags
  ['Slack', 800.00, 'Software', 12],
];

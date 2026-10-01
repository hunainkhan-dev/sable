// Production data layer — Postgres via @vercel/postgres (works on Vercel serverless
// and any Postgres, e.g. Neon/Supabase). Same async interface as server/db.js (SQLite).
// Connection string: POSTGRES_URL (Vercel Postgres) or DATABASE_URL (Neon/others).
import { createPool } from '@vercel/postgres';
import { hashPassword } from './auth.js';

const pool = createPool({ connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL });

let _schema;
function ensureSchema() {
  if (!_schema) _schema = pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      vendor TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      status TEXT NOT NULL DEFAULT 'pending',
      flagged INTEGER NOT NULL DEFAULT 0,
      flag_reason TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      user_id INTEGER,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_tx_company ON transactions(company_id);
  `);
  return _schema;
}
async function q(text, params = []) {
  await ensureSchema();
  return (await pool.query(text, params)).rows;
}

// ---- Company / user ----
export async function createCompany(name) {
  const rows = await q('INSERT INTO companies(name) VALUES ($1) RETURNING id', [name]);
  return rows[0].id;
}
export async function createUser({ companyId, email, password, name, role = 'member' }) {
  const { hash, salt } = hashPassword(password);
  const rows = await q(
    'INSERT INTO users(company_id,email,password_hash,salt,name,role) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [companyId, email.toLowerCase(), hash, salt, name, role]
  );
  return getUserById(rows[0].id);
}
export async function getUserByEmail(email) {
  const rows = await q('SELECT * FROM users WHERE email = $1', [String(email || '').toLowerCase()]);
  return rows[0];
}
export async function getUserById(id) {
  const rows = await q('SELECT id,company_id,email,name,role,created_at FROM users WHERE id = $1', [id]);
  return rows[0];
}
export async function getCompany(id) {
  const rows = await q('SELECT id,name,created_at FROM companies WHERE id = $1', [id]);
  return rows[0];
}
export async function updateUserProfile(id, name) {
  await q('UPDATE users SET name = $1 WHERE id = $2', [String(name).slice(0, 80), id]);
  return getUserById(id);
}
export async function updateCompanyName(companyId, name) {
  await q('UPDATE companies SET name = $1 WHERE id = $2', [String(name).slice(0, 80), companyId]);
  return getCompany(companyId);
}
export async function countTeam(companyId) {
  const rows = await q('SELECT COUNT(*)::int AS n FROM users WHERE company_id = $1', [companyId]);
  return rows[0].n;
}

// ---- Transactions (ALWAYS tenant-scoped by companyId) ----
export async function listTransactions(companyId) {
  return q('SELECT * FROM transactions WHERE company_id = $1 ORDER BY occurred_at DESC, id DESC', [companyId]);
}
export async function getTransaction(companyId, id) {
  const rows = await q('SELECT * FROM transactions WHERE company_id = $1 AND id = $2', [companyId, id]);
  return rows[0];
}
export async function insertTransaction(companyId, userId, { vendor, amount, category, occurred_at, status, flagged, flag_reason }) {
  const rows = await q(
    `INSERT INTO transactions (company_id,vendor,amount,category,occurred_at,status,flagged,flag_reason,created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5, now()),$6,$7,$8,$9) RETURNING id`,
    [companyId, vendor, amount, category || 'General', occurred_at || null, status, flagged ? 1 : 0, flag_reason || null, userId]
  );
  return getTransaction(companyId, rows[0].id);
}
export async function updateTransactionStatus(companyId, id, status) {
  const flagged = status === 'flagged' ? 1 : 0;
  await q('UPDATE transactions SET status = $1, flagged = $2 WHERE company_id = $3 AND id = $4', [status, flagged, companyId, id]);
  return getTransaction(companyId, id);
}
export async function deleteTransaction(companyId, id) {
  const rows = await q('DELETE FROM transactions WHERE company_id = $1 AND id = $2 RETURNING id', [companyId, id]);
  return rows.length;
}

// ---- Audit ----
export async function logAudit(companyId, userId, action, detail) {
  await q('INSERT INTO audit_log(company_id,user_id,action,detail) VALUES ($1,$2,$3,$4)', [companyId, userId, action, detail || null]);
}
export async function listAudit(companyId, limit = 20) {
  return q('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.company_id = $1 ORDER BY a.id DESC LIMIT $2', [companyId, limit]);
}

// ---- Seed a demo tenant. Returns {companyId, userId} on first run, else null. ----
export async function seedDemoTenant() {
  if (await getUserByEmail('demo@sable.io')) return null;
  const companyId = await createCompany('Northwind (Demo)');
  const user = await createUser({ companyId, email: 'demo@sable.io', password: 'demo1234', name: 'Amara Reid', role: 'admin' });
  return { companyId, userId: user.id };
}

export const SEED_TRANSACTIONS = [
  ['Amazon Web Services', 8420.55, 'Cloud', 2],
  ['Gusto Payroll', 141200.00, 'Payroll', 0],
  ['WeWork', 6200.00, 'Facilities', 5],
  ['Stripe Fees', 2310.42, 'Fees', 1],
  ['Meridian LLC', 48000.00, 'Vendor', 3],
  ['Meridian LLC', 48000.00, 'Vendor', 3],
  ['Figma', 144.00, 'Software', 7],
  ['Northwind Travel', 985.20, 'Travel', 9],
  ['Kestrel Holdings', 99000.00, 'Vendor', 1],
  ['Slack', 800.00, 'Software', 12],
];

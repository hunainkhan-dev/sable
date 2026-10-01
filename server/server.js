// Sable API + static server. Runs as a normal Node server locally (SQLite) and as a
// Vercel serverless function in production (Postgres). The request handler is exported
// as default for Vercel; a listener is started only outside Vercel.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueToken, verifyToken, verifyPassword } from './auth.js';
import { detectAnomaly } from './anomaly.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

// Pick the data layer: Postgres in production (Vercel), SQLite locally.
const PG = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const store = await import(PG ? './db.pg.js' : './db.js');

const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.json':'application/json', '.ico':'image/x-icon' };

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  let data, ctype;
  if (Buffer.isBuffer(body)) { data = body; ctype = 'application/octet-stream'; }
  else if (typeof body === 'string') { data = body; ctype = 'text/plain; charset=utf-8'; }
  else { data = JSON.stringify(body); ctype = 'application/json'; }
  res.writeHead(status, {
    'Content-Type': ctype,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...headers,
  });
  res.end(data);
}
const json = (res, status, obj) => send(res, status, obj);

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let data = ''; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('payload too large')); req.destroy(); } data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid json')); } });
    req.on('error', reject);
  });
}

const hits = new Map();
function rateLimit(ip, max = 20, windowMs = 60000) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
  rec.n++; hits.set(ip, rec);
  return rec.n <= max;
}

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));

async function auth(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return store.getUserById(payload.sub); // fresh user; scopes everything by company_id
}

async function summary(companyId) {
  const tx = await store.listTransactions(companyId);
  const total = tx.length;
  const clearedTx = tx.filter((t) => t.status === 'cleared');
  const cleared = clearedTx.length;
  const flagged = tx.filter((t) => t.status === 'flagged');
  const totalAmount = tx.reduce((s, t) => s + Number(t.amount), 0);
  const reconciledAmount = clearedTx.reduce((s, t) => s + Number(t.amount), 0);
  const protectedAmount = flagged.reduce((s, t) => s + Number(t.amount), 0);
  const byCat = {};
  tx.forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount); });
  return {
    totalTransactions: total,
    cleared, pending: tx.filter((t) => t.status === 'pending').length,
    anomalies: flagged.length,
    closeProgress: total ? Math.round((cleared / total) * 100) : 0,
    totalAmount, reconciledAmount, protectedAmount,
    categories: Object.entries(byCat).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
  };
}

// ---------- API router ----------
async function api(req, res, url) {
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x';
  const seg = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const route = seg.slice(1);

  if (route[0] === 'health') return json(res, 200, { ok: true, db: PG ? 'postgres' : 'sqlite' });

  // --- public auth routes ---
  if (route[0] === 'auth' && req.method === 'POST') {
    if (!rateLimit(ip)) return json(res, 429, { error: 'Too many attempts. Try again shortly.' });
    const body = await readBody(req).catch(() => null);
    if (!body) return json(res, 400, { error: 'Invalid request' });

    if (route[1] === 'signup') {
      const { email, password, name, company } = body;
      if (!isEmail(email)) return json(res, 400, { error: 'Enter a valid email.' });
      if (!password || String(password).length < 8) return json(res, 400, { error: 'Password must be at least 8 characters.' });
      if (!name || !company) return json(res, 400, { error: 'Name and company are required.' });
      if (await store.getUserByEmail(email)) return json(res, 409, { error: 'An account with this email already exists.' });
      const companyId = await store.createCompany(String(company).slice(0, 80));
      const user = await store.createUser({ companyId, email, password, name: String(name).slice(0, 80), role: 'admin' });
      await store.logAudit(companyId, user.id, 'signup', `Account created for ${email}`);
      return json(res, 201, { token: issueToken({ sub: user.id }), user });
    }
    if (route[1] === 'login') {
      const { email, password } = body;
      const u = await store.getUserByEmail(email);
      if (!u || !verifyPassword(String(password || ''), u.salt, u.password_hash)) {
        return json(res, 401, { error: 'Incorrect email or password.' });
      }
      await store.logAudit(u.company_id, u.id, 'login', `${email} signed in`);
      return json(res, 200, { token: issueToken({ sub: u.id }), user: await store.getUserById(u.id) });
    }
    return json(res, 404, { error: 'Not found' });
  }

  // --- everything below requires auth ---
  const user = await auth(req);
  if (!user) return json(res, 401, { error: 'Authentication required.' });
  const cid = user.company_id;

  if (route[0] === 'me' && req.method === 'GET') {
    const company = await store.getCompany(cid);
    return json(res, 200, { user, company_id: cid, company, team: await store.countTeam(cid) });
  }

  if (route[0] === 'me' && req.method === 'PATCH') {
    const body = await readBody(req).catch(() => ({}));
    const name = String(body.name || '').trim();
    const companyName = String(body.company || '').trim();
    if (name && name.length < 2) return json(res, 400, { error: 'Name is too short.' });
    if (companyName && companyName.length < 2) return json(res, 400, { error: 'Company name is too short.' });
    if (name) await store.updateUserProfile(user.id, name);
    if (companyName) await store.updateCompanyName(cid, companyName);
    await store.logAudit(cid, user.id, 'settings.update', 'Profile updated');
    return json(res, 200, { user: await store.getUserById(user.id), company: await store.getCompany(cid) });
  }

  if (route[0] === 'dashboard' && route[1] === 'summary' && req.method === 'GET') {
    return json(res, 200, await summary(cid));
  }

  if (route[0] === 'audit' && req.method === 'GET') {
    return json(res, 200, { events: await store.listAudit(cid) });
  }

  if (route[0] === 'transactions') {
    if (route.length === 1) {
      if (req.method === 'GET') return json(res, 200, { transactions: await store.listTransactions(cid) });
      if (req.method === 'POST') {
        const body = await readBody(req).catch(() => null);
        if (!body) return json(res, 400, { error: 'Invalid request' });
        const vendor = String(body.vendor || '').trim();
        const amount = Number(body.amount);
        if (!vendor) return json(res, 400, { error: 'Vendor is required.' });
        if (!Number.isFinite(amount) || amount <= 0) return json(res, 400, { error: 'Amount must be a positive number.' });
        const existing = await store.listTransactions(cid);
        const verdict = detectAnomaly({ vendor, amount, occurred_at: body.occurred_at }, existing);
        const tx = await store.insertTransaction(cid, user.id, {
          vendor, amount, category: String(body.category || 'General').slice(0, 40),
          occurred_at: body.occurred_at, status: verdict.status, flagged: verdict.flagged, flag_reason: verdict.reason,
        });
        await store.logAudit(cid, user.id, 'tx.create', `${vendor} $${amount}${verdict.flagged ? ' (FLAGGED)' : ''}`);
        return json(res, 201, { transaction: tx, anomaly: verdict });
      }
    }
    if (route.length === 2) {
      const id = Number(route[1]);
      const existing = await store.getTransaction(cid, id);
      if (!existing) return json(res, 404, { error: 'Transaction not found.' });
      if (req.method === 'PATCH') {
        const body = await readBody(req).catch(() => ({}));
        const status = body.status;
        if (!['cleared', 'flagged', 'pending'].includes(status)) return json(res, 400, { error: 'Invalid status.' });
        const tx = await store.updateTransactionStatus(cid, id, status);
        await store.logAudit(cid, user.id, 'tx.update', `#${id} -> ${status}`);
        return json(res, 200, { transaction: tx });
      }
      if (req.method === 'DELETE') {
        await store.deleteTransaction(cid, id);
        await store.logAudit(cid, user.id, 'tx.delete', `#${id} (${existing.vendor})`);
        return json(res, 200, { ok: true });
      }
    }
  }

  return json(res, 404, { error: 'Not found' });
}

// ---------- static (local dev only; Vercel serves /public itself) ----------
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (p.includes('..')) return send(res, 400, 'Bad request');
  const file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC)) return send(res, 400, 'Bad request');
  fs.readFile(file, (err, data) => {
    if (err) {
      const alt = path.join(PUBLIC, p + '.html');
      if (alt.startsWith(PUBLIC) && fs.existsSync(alt)) return send(res, 200, fs.readFileSync(alt), { 'Content-Type': 'text/html' });
      return send(res, 404, 'Not found');
    }
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
}

// ---------- seed (idempotent, runs once per instance) ----------
let _seeded;
function ensureSeed() {
  if (!_seeded) _seeded = (async () => {
    const t = await store.seedDemoTenant();
    if (!t) return;
    const now = Date.now();
    for (const [vendor, amount, category, daysAgo] of store.SEED_TRANSACTIONS) {
      const occurred_at = new Date(now - daysAgo * 86400000).toISOString();
      const existing = await store.listTransactions(t.companyId);
      const verdict = detectAnomaly({ vendor, amount, occurred_at }, existing);
      await store.insertTransaction(t.companyId, t.userId, { vendor, amount, category, occurred_at, status: verdict.status, flagged: verdict.flagged, flag_reason: verdict.reason });
    }
    await store.logAudit(t.companyId, t.userId, 'seed', 'Demo data loaded');
  })();
  return _seeded;
}

// ---------- request handler (default export for Vercel) ----------
export default async function handler(req, res) {
  try {
    await ensureSeed();
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    json(res, 500, { error: e.message || 'Server error' });
  }
}

// ---------- local listener (skipped on Vercel) ----------
if (!process.env.VERCEL) {
  ensureSeed().then(() => {
    http.createServer(handler).listen(PORT, () => {
      console.log(`\n  Sable running  ->  http://localhost:${PORT}  (${PG ? 'postgres' : 'sqlite'})`);
      console.log(`  Demo login     ->  demo@sable.io / demo1234\n`);
    });
  });
}

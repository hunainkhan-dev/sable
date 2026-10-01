// Sable dashboard — full SPA. Talks to the real API, renders live DB data.
(function () {
  'use strict';
  var token, user;
  try { token = localStorage.getItem('sable-token'); user = JSON.parse(localStorage.getItem('sable-user') || 'null'); } catch (e) {}
  if (!token) { location.replace('/login'); return; }

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var state = { summary: null, transactions: [], audit: [], me: null, filter: 'all', search: '' };
  var fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var fmt2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  async function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, opts.headers || {});
    var r = await fetch('/api' + path, opts);
    if (r.status === 401) { logout(); throw new Error('Session expired'); }
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  function logout() {
    try { localStorage.removeItem('sable-token'); localStorage.removeItem('sable-user'); } catch (e) {}
    location.replace('/login');
  }

  // ---------- utils ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function dateStr(iso) { var d = new Date(iso); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function initials(name) { return String(name || '?').split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  var CAT_COLORS = ['#0070E0', '#009CDE', '#003087', '#3391FF', '#5BB4E8', '#1B4DB1', '#66C7EE', '#0A1F44'];

  // ---------- shared components ----------
  function badge(status) { return '<span class="badge badge--' + status + '">' + status + '</span>'; }
  function rowActions(t) {
    return '<td class="actions">' +
      (t.status !== 'cleared' ? '<button class="mini ok" data-act="clear" data-id="' + t.id + '" title="Approve / clear">✓</button>' : '') +
      (t.status !== 'flagged' ? '<button class="mini warn" data-act="flag" data-id="' + t.id + '" title="Flag">⚑</button>' : '') +
      '<button class="mini del" data-act="delete" data-id="' + t.id + '" title="Delete">✕</button></td>';
  }
  function txRows(list, withActions) {
    if (!list.length) return '<tr><td colspan="' + (withActions ? 6 : 5) + '" class="empty">No transactions.</td></tr>';
    return list.map(function (t) {
      var reason = t.flag_reason ? '<span class="flag-reason" title="' + esc(t.flag_reason) + '">⚠︎ ' + esc(t.flag_reason) + '</span>' : '';
      return '<tr class="' + (t.status === 'flagged' ? 'is-flagged' : '') + '">' +
        '<td><strong>' + esc(t.vendor) + '</strong>' + (reason ? '<br>' + reason : '') + '</td>' +
        '<td class="num">' + fmt2.format(t.amount) + '</td>' +
        '<td>' + esc(t.category) + '</td>' +
        '<td class="muted">' + dateStr(t.occurred_at) + '</td>' +
        '<td>' + badge(t.status) + '</td>' +
        (withActions ? rowActions(t) : '') + '</tr>';
    }).join('');
  }
  function filteredTx() {
    var q = state.search.trim().toLowerCase();
    return state.transactions.filter(function (t) {
      var okF = state.filter === 'all' ? true : t.status === state.filter;
      var okQ = !q || (t.vendor + ' ' + t.category).toLowerCase().indexOf(q) >= 0;
      return okF && okQ;
    });
  }
  function kpiCards(s) {
    return '<section class="kpis">' +
      '<div class="kpi-card kpi-card--ring"><div class="kpi-card__top"><span class="kpi-card__label">Close progress</span><span class="kpi-card__tag up">On track</span></div>' +
        '<div class="kpi-card__ringwrap"><div class="ring" id="kpiRing" style="--p:0"><span class="ring__val">' + s.closeProgress + '%</span></div>' +
        '<div class="kpi-card__ringmeta"><span class="kpi-card__val">' + s.cleared + ' / ' + s.totalTransactions + '</span><span class="kpi-card__meta">cleared</span></div></div></div>' +
      '<div class="kpi-card"><div class="kpi-card__top"><span class="kpi-card__label">Anomalies flagged</span><span class="kpi-card__ic warn">⚑</span></div>' +
        '<span class="kpi-card__val">' + s.anomalies + '</span><span class="kpi-card__meta">' + (s.protectedAmount > 0 ? fmt.format(s.protectedAmount) + ' at risk' : 'all clear') + '</span>' +
        '<svg class="spark" viewBox="0 0 120 34" preserveAspectRatio="none"><path d="M0,26 L20,22 L40,25 L60,14 L80,18 L100,8 L120,12" fill="none" stroke="var(--bad)" stroke-width="2"/></svg></div>' +
      '<div class="kpi-card"><div class="kpi-card__top"><span class="kpi-card__label">Total volume</span><span class="kpi-card__ic">$</span></div>' +
        '<span class="kpi-card__val">' + fmt.format(s.totalAmount) + '</span><span class="kpi-card__meta">this period</span>' +
        '<svg class="spark" viewBox="0 0 120 34" preserveAspectRatio="none"><defs><linearGradient id="sp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--iris)" stop-opacity=".35"/><stop offset="1" stop-color="var(--iris)" stop-opacity="0"/></linearGradient></defs><path d="M0,28 L20,24 L40,26 L60,16 L80,20 L100,10 L120,6 L120,34 L0,34 Z" fill="url(#sp)"/><path d="M0,28 L20,24 L40,26 L60,16 L80,20 L100,10 L120,6" fill="none" stroke="var(--iris)" stroke-width="2"/></svg></div>' +
      '<div class="kpi-card"><div class="kpi-card__top"><span class="kpi-card__label">Reconciled</span><span class="kpi-card__ic good">✓</span></div>' +
        '<span class="kpi-card__val">' + fmt.format(s.reconciledAmount != null ? s.reconciledAmount : 0) + '</span><span class="kpi-card__meta">this period</span>' +
        '<svg class="spark" viewBox="0 0 120 34" preserveAspectRatio="none"><path d="M0,30 L20,28 L40,24 L60,22 L80,15 L100,12 L120,7" fill="none" stroke="var(--good)" stroke-width="2"/></svg></div>' +
    '</section>';
  }
  function chartCard() {
    return '<section class="card chart-card"><div class="card__head"><div><h2>Cash flow forecast</h2><p class="card__sub">AI-projected · next 30 days</p></div><span class="chip chip--ai">Sable AI</span></div>' +
      '<div class="chart-card__body"><div class="chart-legend"><span class="chart-legend__k"><i class="dot dot--iris"></i> Projected</span><span class="chart-legend__k"><i class="dot dot--faint"></i> Actual</span></div>' +
      '<svg class="area-chart" viewBox="0 0 760 240" preserveAspectRatio="none"><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0070E0" stop-opacity=".28"/><stop offset="1" stop-color="#0070E0" stop-opacity="0"/></linearGradient></defs>' +
      '<line class="grid" x1="0" y1="60" x2="760" y2="60"/><line class="grid" x1="0" y1="120" x2="760" y2="120"/><line class="grid" x1="0" y1="180" x2="760" y2="180"/>' +
      '<path class="area-chart__area" d="M0,180 C80,170 120,120 190,130 C260,140 300,80 380,90 C460,100 500,50 580,44 C650,38 700,64 760,40 L760,240 L0,240 Z" fill="url(#areaFill)"/>' +
      '<path class="area-chart__line" d="M0,180 C80,170 120,120 190,130 C260,140 300,80 380,90 C460,100 500,50 580,44 C650,38 700,64 760,40" fill="none" stroke="#0070E0" stroke-width="3"/>' +
      '<path class="area-chart__dash" d="M0,196 C80,190 120,160 190,168 C260,176 300,140 380,150" fill="none" stroke="var(--faint)" stroke-width="2" stroke-dasharray="5 6"/>' +
      '<circle class="area-chart__pt" cx="580" cy="44" r="5" fill="#009CDE"/></svg>' +
      '<div class="chart-x"><span>W1</span><span>W2</span><span>W3</span><span>W4</span></div></div></section>';
  }
  function catsList(s) {
    var max = Math.max.apply(null, s.categories.map(function (c) { return c.amount; }).concat([1]));
    var rows = s.categories.map(function (c) {
      return '<div class="cat"><span class="cat__name">' + esc(c.name) + '</span><span class="cat__track"><i style="width:' + Math.round(c.amount / max * 100) + '%"></i></span><span class="cat__val">' + fmt.format(c.amount) + '</span></div>';
    }).join('');
    return '<section class="card cats-card"><div class="card__head"><h2>Spend by category</h2></div><div class="cats">' + rows + '</div></section>';
  }
  function auditList(events, limit) {
    var list = limit ? events.slice(0, limit) : events;
    if (!list.length) return '<li class="empty">No activity yet.</li>';
    return list.map(function (e) {
      var who = e.user_name ? ' · ' + esc(e.user_name) : '';
      return '<li><span class="audit__act">' + esc(e.action) + who + '</span><span class="audit__detail">' + esc(e.detail || '') + '</span></li>';
    }).join('');
  }
  function donut(cats) {
    var total = cats.reduce(function (s, c) { return s + c.amount; }, 0) || 1;
    var acc = 0, stops = [];
    cats.slice(0, 8).forEach(function (c, i) {
      var start = acc / total * 100; acc += c.amount; var end = acc / total * 100;
      stops.push(CAT_COLORS[i % CAT_COLORS.length] + ' ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%');
    });
    var legend = cats.slice(0, 8).map(function (c, i) {
      return '<li><i style="background:' + CAT_COLORS[i % CAT_COLORS.length] + '"></i>' + esc(c.name) + '<b>' + Math.round(c.amount / total * 100) + '%</b></li>';
    }).join('');
    return '<div class="donut-wrap"><div class="donut" style="background:conic-gradient(' + stops.join(',') + ')"><div class="donut__hole"><span>' + fmt.format(total) + '</span><small>total spend</small></div></div><ul class="donut-legend">' + legend + '</ul></div>';
  }

  // ---------- views ----------
  var VIEWS = {
    overview: {
      title: 'Overview', sub: function () { return 'Welcome back' + (state.me ? ', ' + state.me.user.name.split(' ')[0] : '') + '.'; },
      html: function () {
        var s = state.summary;
        var recent = state.transactions.slice(0, 5);
        return '<div class="app__head"><span class="live-badge"><span class="pulse"></span> Live · ' + s.totalTransactions + ' transactions</span></div>' +
          kpiCards(s) +
          '<div class="panels">' + chartCard() + catsList(s) + '</div>' +
          '<div class="app__grid"><section class="card"><div class="card__head"><h2>Recent transactions</h2><a class="card__link" href="#/transactions">View all →</a></div>' +
            '<div class="table-wrap"><table class="tx-table"><thead><tr><th>Vendor</th><th class="num">Amount</th><th>Category</th><th>Date</th><th>Status</th></tr></thead><tbody>' + txRows(recent, false) + '</tbody></table></div></section>' +
          '<aside class="side"><section class="card"><div class="card__head"><h2>Add transaction</h2></div>' + addFormHtml() + '</section>' +
          '<section class="card"><div class="card__head"><h2>Activity</h2><a class="card__link" href="#/audit">All →</a></div><ul class="audit">' + auditList(state.audit, 6) + '</ul></section></aside></div>';
      },
      mount: function (el) { animateRing(el); wireAddForm(el); }
    },

    transactions: {
      title: 'Transactions', sub: function () { return state.transactions.length + ' total · tenant-isolated'; },
      html: function () {
        var list = filteredTx();
        return '<div class="app__grid app__grid--wide"><section class="card"><div class="card__head"><h2>All transactions <span class="count-pill">' + list.length + '</span></h2>' +
          '<div class="filter" id="filter"><button class="filter__btn' + (state.filter === 'all' ? ' is-active' : '') + '" data-f="all">All</button><button class="filter__btn' + (state.filter === 'flagged' ? ' is-active' : '') + '" data-f="flagged">Flagged</button><button class="filter__btn' + (state.filter === 'cleared' ? ' is-active' : '') + '" data-f="cleared">Cleared</button></div></div>' +
          '<div class="table-wrap"><table class="tx-table"><thead><tr><th>Vendor</th><th class="num">Amount</th><th>Category</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody id="txBody">' + txRows(list, true) + '</tbody></table></div></section>' +
          '<aside class="side"><section class="card"><div class="card__head"><h2>Add transaction</h2></div>' + addFormHtml() + '</section></aside></div>';
      },
      mount: function (el) { wireAddForm(el); wireFilter(el); wireRowActions(el); }
    },

    analytics: {
      title: 'Analytics', sub: function () { return 'Spend intelligence across the close'; },
      html: function () {
        var s = state.summary;
        var vendors = {};
        state.transactions.forEach(function (t) { vendors[t.vendor] = (vendors[t.vendor] || 0) + Number(t.amount); });
        var topV = Object.entries(vendors).map(function (e) { return { name: e[0], amount: e[1] }; }).sort(function (a, b) { return b.amount - a.amount; }).slice(0, 6);
        var maxV = Math.max.apply(null, topV.map(function (v) { return v.amount; }).concat([1]));
        var statusRow = [['cleared', s.cleared, 'good'], ['flagged', s.anomalies, 'bad'], ['pending', s.pending, 'gold']];
        return kpiCards(s) +
          '<div class="panels"><section class="card chart-card"><div class="card__head"><div><h2>Spend distribution</h2><p class="card__sub">By category · live</p></div></div><div class="chart-card__body">' + donut(s.categories) + '</div></section>' +
          '<section class="card"><div class="card__head"><h2>Status breakdown</h2></div><div class="cats">' +
            statusRow.map(function (r) { var pct = s.totalTransactions ? Math.round(r[1] / s.totalTransactions * 100) : 0; return '<div class="cat"><span class="cat__name">' + r[0] + '</span><span class="cat__track"><i class="i--' + r[2] + '" style="width:' + pct + '%"></i></span><span class="cat__val">' + r[1] + '</span></div>'; }).join('') +
          '</div></section></div>' +
          '<div class="panels"><section class="card"><div class="card__head"><h2>Top vendors</h2></div><div class="cats">' +
            topV.map(function (v) { return '<div class="cat cat--vendor"><span class="cat__name">' + esc(v.name) + '</span><span class="cat__track"><i style="width:' + Math.round(v.amount / maxV * 100) + '%"></i></span><span class="cat__val">' + fmt.format(v.amount) + '</span></div>'; }).join('') +
          '</div></section>' + chartCard() + '</div>';
      },
      mount: function (el) { animateRing(el); }
    },

    approvals: {
      title: 'Approvals', sub: function () { return (state.summary ? state.summary.anomalies : 0) + ' items need review'; },
      html: function () {
        var flagged = state.transactions.filter(function (t) { return t.status === 'flagged'; });
        if (!flagged.length) return '<div class="empty-state"><div class="empty-state__ic">✓</div><h2>All clear</h2><p>No flagged transactions need your approval right now. Sable is watching every entry in real time.</p><a class="btn btn--primary" href="#/transactions">View transactions</a></div>';
        return '<section class="card"><div class="card__head"><h2>Pending approvals <span class="count-pill count-pill--bad">' + flagged.length + '</span></h2><p class="card__sub">' + fmt.format(flagged.reduce(function (a, t) { return a + Number(t.amount); }, 0)) + ' flagged</p></div>' +
          '<div class="approvals">' + flagged.map(function (t) {
            return '<div class="approval"><div class="approval__main"><div class="approval__vendor">' + esc(t.vendor) + '<span class="approval__amt">' + fmt2.format(t.amount) + '</span></div>' +
              '<div class="approval__reason">⚠︎ ' + esc(t.flag_reason || 'Flagged for review') + '</div>' +
              '<div class="approval__meta">' + esc(t.category) + ' · ' + dateStr(t.occurred_at) + '</div></div>' +
              '<div class="approval__actions"><button class="btn btn--primary btn--sm" data-act="clear" data-id="' + t.id + '">Approve</button><button class="mini del" data-act="delete" data-id="' + t.id + '" title="Delete">✕</button></div></div>';
          }).join('') + '</div></section>';
      },
      mount: function (el) { wireRowActions(el); }
    },

    audit: {
      title: 'Audit log', sub: function () { return 'Every action, recorded'; },
      html: function () {
        return '<section class="card"><div class="card__head"><h2>Activity trail</h2><span class="chip">Immutable</span></div><ul class="audit audit--full">' + auditList(state.audit) + '</ul></section>';
      },
      mount: function () {}
    },

    settings: {
      title: 'Settings', sub: function () { return 'Account & workspace'; },
      html: function () {
        var u = state.me ? state.me.user : user;
        var co = state.me && state.me.company ? state.me.company.name : '';
        var team = state.me ? state.me.team : 1;
        return '<div class="settings-grid">' +
          '<section class="card"><div class="card__head"><h2>Profile</h2></div><form id="settingsForm" class="tx-form">' +
            '<label>Full name<input name="name" value="' + esc(u.name) + '" required minlength="2" /></label>' +
            '<label>Company<input name="company" value="' + esc(co) + '" required minlength="2" /></label>' +
            '<label>Work email<input value="' + esc(u.email) + '" disabled /></label>' +
            '<button type="submit" class="btn btn--primary btn--block">Save changes</button>' +
            '<p class="tx-form__note" id="settingsNote" role="status">Your changes are saved to the database.</p></form></section>' +
          '<div class="side">' +
            '<section class="card"><div class="card__head"><h2>Workspace</h2></div><div class="meta-list">' +
              '<div class="meta-row"><span>Plan</span><b>Scale</b></div>' +
              '<div class="meta-row"><span>Role</span><b>' + esc(u.role) + '</b></div>' +
              '<div class="meta-row"><span>Team members</span><b>' + team + '</b></div>' +
              '<div class="meta-row"><span>Member since</span><b>' + dateStr(u.created_at) + '</b></div></div></section>' +
            '<section class="card"><div class="card__head"><h2>Appearance</h2></div><div class="meta-list"><div class="meta-row"><span>Theme</span><button class="btn btn--ghost btn--sm" id="themeToggle2">Toggle light / dark</button></div></div></section>' +
            '<section class="card card--danger"><div class="card__head"><h2>Session</h2></div><div class="meta-list"><p class="card__sub" style="padding:0 0 12px">End your session on this device.</p><button class="btn btn--ghost btn--block" id="logoutBtn2">Sign out</button></div></section>' +
          '</div></div>';
      },
      mount: function (el) { wireSettings(el); }
    }
  };

  // ---------- add-transaction form (shared) ----------
  function addFormHtml() {
    return '<form id="txForm" class="tx-form"><label>Vendor<input name="vendor" required placeholder="e.g. Meridian LLC" /></label>' +
      '<label>Amount ($)<input name="amount" type="number" step="0.01" min="0" required placeholder="0.00" /></label>' +
      '<label>Category<select name="category"><option>General</option><option>Cloud</option><option>Payroll</option><option>Software</option><option>Vendor</option><option>Travel</option><option>Facilities</option><option>Fees</option></select></label>' +
      '<button type="submit" class="btn btn--primary btn--block">Add &amp; scan</button>' +
      '<p class="tx-form__note" id="txNote" role="status">Sable runs anomaly detection on every entry.</p></form>';
  }

  // ---------- mount wiring ----------
  function animateRing(el) {
    var ring = el.querySelector('#kpiRing');
    if (ring && state.summary) { requestAnimationFrame(function () { ring.style.setProperty('--p', state.summary.closeProgress); }); }
  }
  function wireAddForm(el) {
    var txForm = el.querySelector('#txForm'); if (!txForm) return;
    txForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var note = el.querySelector('#txNote');
      var body = Object.fromEntries(new FormData(txForm).entries());
      var btn = txForm.querySelector('button'); btn.disabled = true;
      try {
        var res = await api('/transactions', { method: 'POST', body: JSON.stringify(body) });
        if (res.anomaly && res.anomaly.flagged) { note.textContent = '⚠︎ Flagged: ' + res.anomaly.reason; note.className = 'tx-form__note flagged'; }
        else { note.textContent = '✓ Added and cleared — no anomalies.'; note.className = 'tx-form__note ok'; }
        txForm.reset();
        await reload(); render(true);
      } catch (err) { note.textContent = err.message; note.className = 'tx-form__note err'; }
      btn.disabled = false;
    });
  }
  function wireFilter(el) {
    var f = el.querySelector('#filter'); if (!f) return;
    f.addEventListener('click', function (e) {
      var b = e.target.closest('.filter__btn'); if (!b) return;
      state.filter = b.dataset.f; render(true);
    });
  }
  function wireRowActions(el) {
    el.addEventListener('click', async function (e) {
      var btn = e.target.closest('button[data-act]'); if (!btn) return;
      var id = btn.dataset.id, act = btn.dataset.act; btn.disabled = true;
      try {
        if (act === 'delete') await api('/transactions/' + id, { method: 'DELETE' });
        else await api('/transactions/' + id, { method: 'PATCH', body: JSON.stringify({ status: act === 'clear' ? 'cleared' : 'flagged' }) });
        await reload(); render(true);
      } catch (err) { alert(err.message); btn.disabled = false; }
    });
  }
  function wireSettings(el) {
    var form = el.querySelector('#settingsForm');
    if (form) form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var note = el.querySelector('#settingsNote');
      var body = Object.fromEntries(new FormData(form).entries());
      var btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        var res = await api('/me', { method: 'PATCH', body: JSON.stringify(body) });
        state.me.user = res.user; state.me.company = res.company;
        try { localStorage.setItem('sable-user', JSON.stringify(res.user)); } catch (x) {}
        note.textContent = '✓ Saved.'; note.className = 'tx-form__note ok';
        paintIdentity(); await loadAudit();
      } catch (err) { note.textContent = err.message; note.className = 'tx-form__note err'; }
      btn.disabled = false;
    });
    var t2 = el.querySelector('#themeToggle2');
    if (t2) t2.addEventListener('click', function () { var tb = document.getElementById('themeToggle'); if (tb) tb.click(); });
    var l2 = el.querySelector('#logoutBtn2');
    if (l2) l2.addEventListener('click', logout);
  }

  // ---------- router ----------
  function currentView() { var h = location.hash.replace(/^#\/?/, ''); return VIEWS[h] ? h : 'overview'; }
  function render(keepScroll) {
    var name = currentView(), v = VIEWS[name];
    var host = document.getElementById('view');
    var y = keepScroll ? window.scrollY : 0;
    host.innerHTML = v.html();
    host.setAttribute('data-view', name);
    document.getElementById('viewTitle').textContent = v.title;
    document.getElementById('viewSub').textContent = typeof v.sub === 'function' ? v.sub() : v.sub;
    document.querySelectorAll('.side-nav__item').forEach(function (a) { a.classList.toggle('is-active', a.dataset.view === name); });
    if (v.mount) v.mount(host);
    if (keepScroll) window.scrollTo(0, y);
    if (window.__toggleSide) window.__toggleSide(false);
  }

  // ---------- identity + notifications ----------
  function paintIdentity() {
    var u = state.me ? state.me.user : user;
    var co = state.me && state.me.company ? state.me.company.name : '';
    var set = function (id, val) { var e = document.getElementById(id); if (e) e.textContent = val; };
    set('userName', u.name); set('userAvatar', initials(u.name)); set('companyName', co || ('Company #' + (state.me ? state.me.company_id : '')));
    var n = state.summary ? state.summary.anomalies : 0;
    var pill = document.getElementById('navFlagged'); if (pill) { pill.textContent = n; pill.hidden = !n; }
    var dot = document.getElementById('notifDot'); if (dot) dot.hidden = !n;
  }

  // ---------- data ----------
  async function loadAudit() { var a = await api('/audit'); state.audit = a.events; }
  async function reload() {
    state.summary = await api('/dashboard/summary');
    var tx = await api('/transactions'); state.transactions = tx.transactions;
    await loadAudit();
    paintIdentity();
  }

  // ---------- init ----------
  document.getElementById('logoutBtn').addEventListener('click', logout);
  var search = document.getElementById('globalSearch');
  if (search) search.addEventListener('input', function () {
    state.search = search.value;
    if (currentView() !== 'transactions') { location.hash = '#/transactions'; }
    else render(true);
  });
  document.getElementById('notifBtn').addEventListener('click', function () { location.hash = '#/approvals'; });
  window.addEventListener('hashchange', function () { render(false); });

  (async function init() {
    try {
      state.me = await api('/me');
      try { localStorage.setItem('sable-user', JSON.stringify(state.me.user)); } catch (e) {}
      await reload();
      render(false);
    } catch (e) {
      document.getElementById('view').innerHTML = '<div class="empty-state"><h2>Something went wrong</h2><p>' + esc(e.message) + '</p></div>';
    }
  })();
})();

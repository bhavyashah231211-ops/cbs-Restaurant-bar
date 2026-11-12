/* CBSystem Restaurant — cloud adapter + plan permissions.
   Loaded AFTER the POS script (staff/index.html adds it). It replaces the old direct-Supabase sync with the
   secure multi-tenant function (staff key per business) and applies the venue's plan: which screens are on,
   table / staff / device limits. The POS code itself (pos.html) is not changed. */
(function () {
  'use strict';
  const API = 'https://wpfqxxnqksbkyzmcipft.supabase.co/functions/v1/cbs-biz';
  const KEYK = 'cbs_rest_key', BIZK = 'cbs_rest_biz', DEVK = 'cbs_rest_dev', FEATK = 'cbs_rest_feat', PAIDK = 'cbs_rest_paid';

  const BIZ = (function () {
    let b = (new URLSearchParams(location.search).get('biz') || '').trim().toLowerCase();
    try {
      const old = localStorage.getItem(BIZK) || '';
      if (b) { if (old && old !== b) localStorage.removeItem(KEYK); localStorage.setItem(BIZK, b); }
      else b = old;
    } catch (e) {}
    return b;
  })();
  /* Remove this device's local copy, but keep a one-time backup if it came from the old standalone POS */
  function stash() {
    try {
      const raw = localStorage.getItem('cbs2');
      if (raw && !JSON.parse(raw)._biz && !localStorage.getItem('cbs2_legacy_backup')) localStorage.setItem('cbs2_legacy_backup', raw);
    } catch (e) {}
    try { localStorage.removeItem('cbs2'); } catch (e) {}
  }

  const getKey = () => { try { return localStorage.getItem(KEYK) || ''; } catch (e) { return ''; } };
  function deviceId() {
    try {
      let d = localStorage.getItem(DEVK);
      if (!d) {
        d = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (String(Date.now()) + Math.random().toString(36).slice(2));
        localStorage.setItem(DEVK, d);
      }
      return d;
    } catch (e) { return ''; }
  }

  /* ---------- plan / permissions (sent by the server on every sync) ---------- */
  const FEAT_ALL = { qr_order: true, takeaway: true, kitchen: true, bar: true, bookings: true, reports: 'full', sumup: true, owner_access: true, max_tables: null, max_staff: null, max_devices: null };
  let FEAT = Object.assign({}, FEAT_ALL);
  try { Object.assign(FEAT, JSON.parse(localStorage.getItem(FEATK + ':' + BIZ) || '{}')); } catch (e) {}

  const st = document.createElement('style');
  st.textContent = '.cbs-off{display:none!important}';
  document.head.appendChild(st);

  function setFeatures(f) {
    if (!f || typeof f !== 'object') return;
    FEAT = Object.assign({}, FEAT_ALL, f);
    try { localStorage.setItem(FEATK + ':' + BIZ, JSON.stringify(FEAT)); } catch (e) {}
    applyFeatures();
  }
  function setPaid(p) {
    try { if (p) localStorage.setItem(PAIDK + ':' + BIZ, p); else localStorage.removeItem(PAIDK + ':' + BIZ); } catch (e) {}
    applyFeatures();
  }

  function planNote() {
    let n = document.getElementById('cbs-plan-note'), pu = '';
    try { pu = localStorage.getItem(PAIDK + ':' + BIZ) || ''; } catch (e) {}
    let msg = '';
    if (pu) {
      const days = Math.ceil((new Date(pu).getTime() - Date.now()) / 864e5);
      if (days <= 7) msg = days >= 0
        ? 'Subscription ends ' + new Date(pu).toLocaleDateString('en-GB') + ' (' + days + ' day' + (days === 1 ? '' : 's') + ' left)'
        : 'Subscription overdue. Please renew to avoid interruption';
    }
    if (!msg) { if (n) n.remove(); return; }
    if (!n) {
      n = document.createElement('div'); n.id = 'cbs-plan-note';
      n.style.cssText = 'position:fixed;left:10px;bottom:calc(8px + env(safe-area-inset-bottom,0px));z-index:9997;background:#2a1a10;border:1px solid #ff6b35;color:#ffb38f;border-radius:8px;padding:4px 10px;font-size:11px;font-family:system-ui,sans-serif';
      document.body.appendChild(n);
    }
    if (n.textContent !== msg) n.textContent = msg;
  }

  function applyFeatures() {
    if (!document.body) return;
    const off = (sel, on) => document.querySelectorAll(sel).forEach(e => e.classList.toggle('cbs-off', !!on));
    const noSelf = !FEAT.qr_order && !FEAT.takeaway;
    off('.sc-kitchen', !FEAT.kitchen);
    off('.sc-bar', !FEAT.bar);
    off('.sc-self', noSelf);
    document.querySelectorAll('#t-tabs .tab').forEach(b => {
      const c = b.getAttribute('onclick') || '';
      const hide = (!FEAT.kitchen && /'(k-view|ow-k)'/.test(c)) || (!FEAT.bar && /'(bar-view|ow-bar)'/.test(c)) || (!FEAT.bookings && c.indexOf("'ow-bk'") > -1);
      b.classList.toggle('cbs-off', hide);
    });
    off('button[onclick="sendK()"],button[onclick="wSendKitchen()"]', !FEAT.kitchen);
    off('button[onclick="sendBr()"],button[onclick="wSendBar()"]', !FEAT.bar);
    off('#qr-toggle-btn', !FEAT.qr_order);
    const qr = document.getElementById('qr-base-url');
    if (qr) { const c = qr.closest('.set-card'); if (c) c.classList.toggle('cbs-off', noSelf); }
    const tt = document.getElementById('t-type');
    if (tt) { const sf = tt.closest('.sf'), col = sf && sf.parentElement; if (col) col.classList.toggle('cbs-off', !FEAT.sumup); }
    if (!FEAT.sumup) {
      const l = document.querySelector('#pm-card .pay-sb'); if (l && l.textContent !== 'Card machine') l.textContent = 'Card machine';
      document.querySelectorAll('.sumup-logo').forEach(e => { if (e.textContent !== 'CARD') e.textContent = 'CARD'; });
    }
    const ti = document.getElementById('s-tc'); if (ti && FEAT.max_tables) ti.max = FEAT.max_tables;
    planNote();
  }

  /* reports: "basic" plan keeps only the summary cards */
  function trimReport(id) {
    if (FEAT.reports !== 'basic') return;
    const el = document.getElementById(id); if (!el) return;
    const keep = el.querySelector('.dash-g'), title = el.firstElementChild;
    Array.prototype.slice.call(el.children).forEach(c => { if (c !== keep && c !== title) c.remove(); });
    if (!document.getElementById(id + '-up')) {
      const n = document.createElement('div'); n.id = id + '-up';
      n.style.cssText = 'margin-top:14px;padding:12px;border:1px dashed var(--border);border-radius:10px;color:var(--text2);font-size:0.8rem';
      n.textContent = 'Detailed reports are not included in your plan. Contact support to upgrade.';
      el.appendChild(n);
    }
  }
  function wrap(name, fn) {
    const o = window[name]; if (typeof o !== 'function') return;
    window[name] = function () { return fn(o, this, arguments); };
  }
  wrap('renderRPT', function (o, t, a) { const r = o.apply(t, a); try { trimReport('rpt-view'); } catch (e) {} return r; });
  wrap('renderORpt', function (o, t, a) { const r = o.apply(t, a); try { trimReport('ow-rpt'); } catch (e) {} return r; });

  /* staff limit (the server also enforces it) */
  const activeStaff = (skip) => DB.get('staff').filter((s, i) => s.active !== false && i !== skip).length;
  wrap('addStaff', function (o, t, a) {
    if (FEAT.max_staff && activeStaff(-1) >= FEAT.max_staff) { toast('Your plan allows ' + FEAT.max_staff + ' staff logins', '⚠️', 't-o'); return; }
    return o.apply(t, a);
  });
  wrap('upS', function (o, t, a) {
    if (a[1] === 'active' && a[2] && FEAT.max_staff && activeStaff(a[0]) >= FEAT.max_staff) {
      toast('Your plan allows ' + FEAT.max_staff + ' staff logins', '⚠️', 't-o'); renderStaffMgr(); return;
    }
    return o.apply(t, a);
  });
  /* table limit (the server also enforces it) */
  wrap('saveVenue', function (o, t, a) {
    const i = document.getElementById('s-tc');
    if (FEAT.max_tables && i && parseInt(i.value) > FEAT.max_tables) { i.value = FEAT.max_tables; toast('Your plan allows up to ' + FEAT.max_tables + ' tables', '⚠️', 't-o'); }
    return o.apply(t, a);
  });

  try {
    let raf = 0;
    new MutationObserver(function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; try { applyFeatures(); } catch (e) {} });
    }).observe(document.body, { childList: true, subtree: true });
  } catch (e) {}
  window.addEventListener('load', function () { try { applyFeatures(); } catch (e) {} });

  let ts = 0, pollT = null, pushT = null, pushing = false, dirty = false, seq = 0, connected = false, gotFirst = false, pullN = 0;

  async function call(action, extra) {
    const r = await fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action, biz: BIZ, key: getKey(), device: deviceId() }, extra || {}))
    });
    return { s: r.status, j: await r.json().catch(() => ({})) };
  }

  /* ---------- local data belongs to one business only ---------- */
  const origLoad = DB.load;
  DB.load = function () {
    try {
      const raw = localStorage.getItem('cbs2');
      const o = raw ? JSON.parse(raw) : null;
      if (o && o._biz !== BIZ) stash();
      this._fresh = !localStorage.getItem('cbs2');
    } catch (e) { this._fresh = true; }
    origLoad.call(this);
    this.d._biz = BIZ;
    if (this.d.cfg) this.d.cfg.cloudMode = true;
  };

  /* ---------- saving ---------- */
  DB.save = function () {
    try { localStorage.setItem('cbs2', JSON.stringify(this.d)); } catch (e) {}
    this._cbs.forEach(fn => { try { fn(); } catch (e) {} });
    if (!this._applyingRemote && connected && gotFirst) queuePush();
  };
  DB._queuePush = queuePush;

  function queuePush() { dirty = true; seq++; clearTimeout(pushT); pushT = setTimeout(doPush, 250); }

  async function doPush() {
    if (pushing) { pushT = setTimeout(doPush, 300); return; }
    pushing = true; const mine = seq; setSyncDot('syncing');
    try {
      const copy = JSON.parse(JSON.stringify(DB.d)); delete copy._biz;
      const r = await call('push', { data: copy });
      if (r.s === 200 && r.j.ok) { ts = r.j.ts; if (seq === mine) dirty = false; setSyncDot('ok'); }
      else if (r.s === 403 && r.j && r.j.error === 'staff_limit') {
        // refused: drop the local change and reload the saved data, so syncing never gets stuck
        dirty = false; ts = 0; setSyncDot('ok');
        toast(r.j.message || 'Staff limit reached for your plan', '⚠️', 't-o');
        setTimeout(pull, 300);
      }
      else if (r.s === 401 || r.s === 403) authFail(r.j);
      else { setSyncDot('off'); pushT = setTimeout(doPush, 5000); }
    } catch (e) { setSyncDot('off'); pushT = setTimeout(doPush, 5000); }
    pushing = false;
  }

  /* ---------- pulling ---------- */
  DB.initCloud = function () {
    clearInterval(pollT); connected = false;
    if (!API || !BIZ || !getKey()) { setSyncDot('off'); return; }
    connected = true; setSyncDot('syncing');
    pull(); pollT = setInterval(pull, 1500);
  };

  async function pull() {
    if (!connected || pushing || dirty) return;
    try {
      // the device id is sent on the first pull and about every 30 seconds after that
      const r = await call('pull', { since: ts, device: (pullN++ % 20 === 0) ? deviceId() : undefined });
      if (r.s === 401 || r.s === 403) { authFail(r.j); return; }
      if (r.s !== 200) throw new Error('bad');
      if (r.j.features) setFeatures(r.j.features);
      if ('paid_until' in r.j) setPaid(r.j.paid_until);
      if (r.j.unchanged) { setSyncDot('ok'); first(); return; }
      if (!r.j.data) return;
      if (pushing || dirty) return;
      adopt(r.j.data, r.j.ts);
    } catch (e) { setSyncDot('off'); }
  }

  function adopt(data, t) {
    DB._applyingRemote = true;
    const d = DB._safeRemote(data);
    d._biz = BIZ; d.cfg = d.cfg || {}; d.cfg.cloudMode = true;
    DB.d = d; ts = t;
    try { localStorage.setItem('cbs2', JSON.stringify(d)); } catch (e) {}
    DB._cbs.forEach(fn => { try { fn(); } catch (e) {} });
    DB._applyingRemote = false;
    setSyncDot('ok');
    const el = document.getElementById('sb-sync');
    if (el) el.textContent = 'Synced ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    try { initStationScreen(); } catch (e) {}
    first();
  }

  function first() { if (!gotFirst) { gotFirst = true; hideOverlay(); } }

  // Keep the live screens fresh when another device changes something
  DB.sub(function () {
    if (!S.user) return;
    try {
      if (S.station === 'till' && S.view === 'pos-view') renderTG();
      if (S.station === 'waiter' && S.view === 'wpos-view' && !S.selTable) renderWaiterGrid();
    } catch (e) {}
  });

  function authFail(j) {
    connected = false; clearInterval(pollT);
    const e = j && j.error;
    if (e === 'suspended') { showMsg('This account is suspended. Please contact support.'); return; }
    if (e === 'expired') { showMsg('Your subscription has expired. Please contact support to renew.'); return; }
    if (e === 'device_limit') { showMsg((j.message || 'Device limit reached for your plan') + '. Ask your administrator to free a device.'); return; }
    try { localStorage.removeItem(KEYK); } catch (x) {}
    showConnect('The staff key is no longer valid. Enter the new key.');
  }

  /* ---------- connect screen ---------- */
  function overlay() {
    let o = document.getElementById('cbs-conn');
    if (!o) {
      o = document.createElement('div'); o.id = 'cbs-conn';
      o.style.cssText = "position:fixed;inset:0;z-index:99999;background:#0a0a0f;display:flex;align-items:center;justify-content:center;padding:20px;font-family:'DM Sans',system-ui,sans-serif;color:#f0f0f8;overflow:auto";
      document.body.appendChild(o);
    }
    return o;
  }
  function hideOverlay() { const o = document.getElementById('cbs-conn'); if (o) o.remove(); }
  function showMsg(text) {
    const o = overlay(); o.innerHTML = '<div style="text-align:center;max-width:340px"><div style="font-family:\'Bebas Neue\',Impact,sans-serif;font-size:2.6rem;letter-spacing:4px;color:#ff6b35">CBSYSTEM</div><p id="cbs-msg" style="margin-top:10px;color:#9090b0"></p></div>';
    document.getElementById('cbs-msg').textContent = text;
  }
  function showConnect(err) {
    const o = overlay();
    o.innerHTML = '<div style="width:100%;max-width:340px"><div style="font-family:\'Bebas Neue\',Impact,sans-serif;font-size:2.6rem;letter-spacing:4px;color:#ff6b35;text-align:center">CBSYSTEM</div>'
      + '<p style="text-align:center;color:#9090b0;margin:4px 0 16px;font-size:.85rem">Connect this device to your business</p>'
      + '<label style="font-size:.72rem;color:#9090b0">Business id</label><input id="cbs-b" autocomplete="off" style="width:100%;margin:4px 0 12px;padding:10px;border-radius:9px;border:1px solid #2a2a40;background:#12121a;color:#f0f0f8;font:inherit">'
      + '<label style="font-size:.72rem;color:#9090b0">Staff key</label><input id="cbs-k" autocomplete="off" style="width:100%;margin:4px 0 12px;padding:10px;border-radius:9px;border:1px solid #2a2a40;background:#12121a;color:#f0f0f8;font:inherit">'
      + '<button id="cbs-go" style="width:100%;padding:12px;border:0;border-radius:10px;background:#ff6b35;color:#fff;font:700 .95rem inherit;cursor:pointer">Connect</button>'
      + '<p id="cbs-err" style="color:#ff4560;font-size:.8rem;min-height:20px;margin-top:10px;text-align:center"></p></div>';
    document.getElementById('cbs-b').value = BIZ;
    document.getElementById('cbs-err').textContent = err || '';
    const go = document.getElementById('cbs-go');
    go.onclick = connect;
    document.getElementById('cbs-k').addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
  }
  async function connect() {
    const b = document.getElementById('cbs-b').value.trim().toLowerCase();
    const k = document.getElementById('cbs-k').value.trim();
    const err = document.getElementById('cbs-err');
    if (!b || !k) { err.textContent = 'Enter the business id and the staff key'; return; }
    err.textContent = 'Checking…';
    try {
      const r = await call('pull', { biz: b, key: k, since: -1 });
      if (r.s === 200) {
        try { localStorage.setItem(BIZK, b); localStorage.setItem(KEYK, k); if (b !== BIZ) stash(); } catch (e) {}
        location.href = location.pathname + '?biz=' + encodeURIComponent(b);
      } else if (r.s === 403) {
        const e = r.j && r.j.error;
        err.textContent = e === 'device_limit' ? (r.j.message || 'Device limit reached for your plan') + '. Ask your administrator.'
          : e === 'expired' ? 'Your subscription has expired. Please contact support.'
          : 'This account is suspended. Please contact support.';
      }
      else err.textContent = 'Business id or staff key not recognised';
    } catch (e) { err.textContent = 'Cannot reach the server. Check the internet connection.'; }
  }
  window.cbsDisconnect = function () {
    if (!confirm('Disconnect this device? You will need the staff key to connect again.')) return;
    try { localStorage.removeItem(KEYK); stash(); } catch (e) {}
    location.href = location.pathname;
  };

  window.addEventListener('load', function () {
    if (!API || /YOUR-PROJECT/.test(API)) { showMsg('Setup needed: the Supabase function address is missing.'); return; }
    if (!BIZ || !getKey()) { showConnect(); return; }
    if (DB._fresh) {
      showMsg('Loading your data…');
      setTimeout(function () { if (!gotFirst) showConnect('Cannot reach the server, or the key is wrong. Check and try again.'); }, 9000);
    }
  });

  /* ---------- customer order page / QR codes ---------- */
  window.orderPageUrl = function () {
    return location.origin + location.pathname.replace(/staff\/(index\.html)?$/, 'customer/') + '?biz=' + encodeURIComponent(BIZ);
  };
  window.openSelfOrder = function () {
    window.open(orderPageUrl(), 'CBSSelfOrder', 'width=820,height=740,resizable=yes');
    toast('Self-order kiosk opened', '📲', 't-b');
  };
  window.downloadSelfOrderFile = function () {
    const u = orderPageUrl();
    try { navigator.clipboard.writeText(u); } catch (e) {}
    toast('Order page link copied', '📋', 't-g');
  };

  /* ---------- Settings screen tweaks ---------- */
  const QRGUIDE = '<summary style="cursor:pointer;font-size:0.74rem;font-weight:700;color:var(--gold);letter-spacing:1px;text-transform:uppercase;padding:8px 0">ℹ️ How QR Self-Ordering Works (tap to expand)</summary>'
    + '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px;margin-top:6px;font-size:0.74rem;line-height:1.75;color:var(--text2)">'
    + '<ol style="padding-left:18px"><li>Click <b>Generate Table QRs</b> (and Bar QRs), then <b>Print All</b>. Put one QR on each table.</li>'
    + '<li>The customer scans it. Their phone asks staff to confirm the table.</li>'
    + '<li>A <b>🔔 Requests</b> button appears at the top of the till or owner screen. Tap <b>Approve</b>.</li>'
    + '<li>The customer sees your menu, builds an order and taps <b>Place Order</b>. It goes straight to the Kitchen and Bar screens.</li>'
    + '<li>Customers pay at the till. Card payment on the customer\'s phone is not available.</li></ol>'
    + '<p style="margin-top:8px">Only items marked <b>Avail</b> in the Menu Manager are shown. Prices always come from your menu.</p></div>';

  function patchSettings() {
    const m = document.getElementById('s-mode');
    if (m) {
      const card = m.closest('.set-card'), sf = m.closest('.sf');
      if (sf) sf.style.display = 'none';
      const cf = document.getElementById('cloud-fields'); if (cf) cf.style.display = 'none';
      const btn = card && card.querySelector('button[onclick="saveCloud()"]');
      if (btn) {
        const box = document.createElement('div');
        box.innerHTML = '<div style="font-size:0.78rem;line-height:1.7;margin-bottom:8px">☁️ Connected to <b></b><br><span style="color:var(--text2)">Every device using this staff key shares one live system.</span></div>'
          + '<button class="btn btn-o" style="width:100%;font-size:0.72rem" onclick="cbsDisconnect()">Disconnect this device</button>';
        box.querySelector('b').textContent = BIZ;
        btn.replaceWith(box);
      }
    }
    const d = document.querySelector('#ow-set details'); if (d) d.innerHTML = QRGUIDE;
    const u = document.getElementById('qr-base-url'); if (u) u.value = orderPageUrl();
    document.querySelectorAll('#ow-set button[onclick="downloadSelfOrderFile()"]').forEach(b => { b.textContent = '📋 Copy order page link'; });
  }
  const origRenderSet = window.renderSet;
  window.renderSet = function () { origRenderSet(); try { patchSettings(); applyFeatures(); } catch (e) {} };
})();

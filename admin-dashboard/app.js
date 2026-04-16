'use strict';

// ─── Config ────────────────────────────────────────────────────────────────
const SERVER_URL = window.REMOTESHIELD_SERVER || 'https://YOUR_SERVER_STATIC_IP';
let authToken = null;
let socket = null;
let activeTab = 'overview';

// ─── DOM Helpers ───────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const hide = (id) => $(`${id}`)?.classList.add('hidden');
const show = (id) => $(`${id}`)?.classList.remove('hidden');

// ─── Clock ─────────────────────────────────────────────────────────────────
function updateClock() {
  $('clock').textContent = new Date().toLocaleTimeString();
}
setInterval(updateClock, 1000);
updateClock();

// ─── API Helper ────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── Login ──────────────────────────────────────────────────────────────────
$('btn-login').addEventListener('click', async () => {
  const username = $('admin-user').value.trim();
  const password = $('admin-pass').value.trim();
  $('login-err').classList.add('hidden');

  try {
    $('btn-login').textContent = 'Authenticating...';
    const data = await api('POST', '/api/auth/login', { username, password });
    authToken = data.accessToken;
    hide('login-gate');
    show('dashboard');
    initSocket();
    loadOverview();
    loadSessions();
  } catch (err) {
    $('login-err').textContent = '⚠️ ' + err.message;
    show('login-err');
  } finally {
    $('btn-login').textContent = '🔐 Sign In';
  }
});

$('admin-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-login').click(); });

// ─── Logout ─────────────────────────────────────────────────────────────────
$('btn-logout').addEventListener('click', async () => {
  try { await api('POST', '/api/auth/logout'); } catch(_) {}
  authToken = null;
  if (socket) socket.disconnect();
  hide('dashboard');
  show('login-gate');
});

// ─── Tab Navigation ──────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const tab = item.dataset.tab;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`tab-${tab}`)?.classList.add('active');
    activeTab = tab;

    const titles = { overview:'Overview', sessions:'Live Sessions', iplogs:'IP Logs',
                     urls:'URL Control', anomalies:'Anomaly Alerts', users:'User Management' };
    $('page-title').textContent = titles[tab] || tab;

    // Load data for tab
    const loaders = { sessions: loadSessions, iplogs: loadIpLogs,
                      urls: loadBlockedUrls, anomalies: loadAnomalies, users: loadUsers };
    loaders[tab]?.();
  });
});

// ─── Socket.io ───────────────────────────────────────────────────────────────
function initSocket() {
  socket = io(SERVER_URL, { auth: { token: authToken } });

  socket.on('connect', () => {
    socket.emit('join_admin', authToken);
    updateConnStatus(true);
  });

  socket.on('disconnect', () => updateConnStatus(false));

  socket.on('user_logged_in', (data) => {
    addActivity(`👤 ${data.username} logged in from ${data.deviceOs} (${data.vpnIp})`, data.timestamp);
    if (activeTab === 'sessions') loadSessions();
    loadOverview();
  });

  socket.on('session_terminated', (data) => {
    addActivity(`🚪 Session terminated: ${data.userId}`, new Date().toISOString());
    if (activeTab === 'sessions') loadSessions();
  });

  socket.on('url_blocked', (data) => {
    addActivity(`🚫 URL blocked: ${data.pattern}`, new Date().toISOString());
    if (activeTab === 'urls') loadBlockedUrls();
  });
}

function updateConnStatus(connected) {
  const dot = $('conn-dot');
  $('conn-label').textContent = connected ? 'Server Connected' : 'Disconnected';
  dot.className = `status-dot ${connected ? 'dot-on' : 'dot-off'}`;
}

// ─── Overview ─────────────────────────────────────────────────────────────────
async function loadOverview() {
  try {
    const stats = await api('GET', '/api/admin/stats');
    $('val-sessions').textContent  = stats.activeSessions;
    $('val-users').textContent     = stats.totalUsers;
    $('val-flagged').textContent   = stats.flaggedLogs24h;
    $('val-anomalies').textContent = stats.unresolvedAlerts;
  } catch(e) { console.error(e); }
}

function addActivity(msg, ts) {
  const list = $('recent-activity');
  const existing = list.querySelector('.empty-state');
  if (existing) existing.remove();

  const item = document.createElement('div');
  item.className = 'activity-item';
  item.innerHTML = `<span>${msg}</span><span class="activity-time">${new Date(ts).toLocaleTimeString()}</span>`;
  list.prepend(item);

  // Keep max 20 items
  while (list.children.length > 20) list.lastChild.remove();
}

// ─── Sessions ─────────────────────────────────────────────────────────────────
$('btn-refresh-sessions').addEventListener('click', loadSessions);

async function loadSessions() {
  const tbody = $('sessions-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading...</td></tr>';
  try {
    const { sessions } = await api('GET', '/api/admin/sessions');
    if (!sessions.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No active sessions</td></tr>';
      return;
    }
    tbody.innerHTML = sessions.map(s => `
      <tr>
        <td><strong>${s.username}</strong></td>
        <td><span class="badge badge-accent">${s.device_os || 'unknown'}</span></td>
        <td><code style="font-family:var(--mono);font-size:12px">${s.vpn_ip || '—'}</code></td>
        <td style="font-size:12px;color:var(--muted)">${new Date(s.started_at).toLocaleString()}</td>
        <td style="font-size:12px;color:var(--muted)">${new Date(s.last_activity).toLocaleTimeString()}</td>
        <td>
          <button class="btn-sm" onclick="forceLogout('${s.user_id}','${s.id}')">Force Logout</button>
        </td>
      </tr>
    `).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--danger)">${e.message}</td></tr>`;
  }
}

async function forceLogout(userId, sessionId) {
  if (!confirm('Force logout this session?')) return;
  try {
    await api('POST', '/api/admin/force-logout', { userId, sessionId });
    loadSessions();
    addActivity(`🚪 Force-logout: user ${userId}`, new Date().toISOString());
  } catch(e) { alert(e.message); }
}
window.forceLogout = forceLogout;

// ─── IP Logs ───────────────────────────────────────────────────────────────────
$('filter-flagged').addEventListener('change', loadIpLogs);

async function loadIpLogs() {
  const tbody = $('iplogs-tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Loading...</td></tr>';
  const flagged = $('filter-flagged').checked;
  try {
    const { logs } = await api('GET', `/api/admin/ip-logs?flagged=${flagged}`);
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No logs found</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(l => `
      <tr>
        <td>${l.username || '—'}</td>
        <td><code style="font-family:var(--mono);font-size:12px">${l.request_ip}</code></td>
        <td>${l.vpn_confirmed ? '<span class="badge badge-success">✓</span>' : '<span class="badge badge-danger">✗</span>'}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${l.url_requested || '—'}</td>
        <td>${l.country_code || '—'}</td>
        <td>${l.flagged ? `<span class="badge badge-danger">Flagged</span>` : '<span class="badge badge-success">OK</span>'}</td>
        <td style="font-size:11px;color:var(--muted);font-family:var(--mono)">${new Date(l.created_at).toLocaleString()}</td>
      </tr>
    `).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--danger)">${e.message}</td></tr>`;
  }
}

// ─── URL Control ───────────────────────────────────────────────────────────────
$('btn-block-url').addEventListener('click', async () => {
  const pattern = $('url-pattern').value.trim();
  const reason  = $('url-reason').value.trim();
  if (!pattern) return;
  const msgEl = $('block-msg');
  try {
    await api('POST', '/api/admin/blocked-urls', { pattern, reason });
    msgEl.textContent = `✅ Blocked: ${pattern}`;
    msgEl.className = 'msg success';
    show('block-msg');
    $('url-pattern').value = '';
    $('url-reason').value  = '';
    loadBlockedUrls();
    setTimeout(() => hide('block-msg'), 3000);
  } catch(e) {
    msgEl.textContent = `⚠️ ${e.message}`;
    msgEl.className = 'msg error';
    show('block-msg');
  }
});

async function loadBlockedUrls() {
  const tbody = $('urls-tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Loading...</td></tr>';
  try {
    const { blockedUrls } = await api('GET', '/api/admin/blocked-urls');
    if (!blockedUrls.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No blocked URLs</td></tr>';
      return;
    }
    tbody.innerHTML = blockedUrls.map(u => `
      <tr>
        <td><code style="font-family:var(--mono);font-size:12px">${u.pattern}</code></td>
        <td style="color:var(--muted);font-size:12px">${u.reason || '—'}</td>
        <td style="font-size:11px;color:var(--muted);font-family:var(--mono)">${new Date(u.created_at).toLocaleDateString()}</td>
        <td><button class="btn-sm" onclick="unblockUrl('${u.id}')">Unblock</button></td>
      </tr>
    `).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state" style="color:var(--danger)">${e.message}</td></tr>`;
  }
}

async function unblockUrl(id) {
  if (!confirm('Unblock this URL?')) return;
  try {
    await api('DELETE', `/api/admin/blocked-urls/${id}`);
    loadBlockedUrls();
  } catch(e) { alert(e.message); }
}
window.unblockUrl = unblockUrl;

// ─── Anomalies ─────────────────────────────────────────────────────────────────
async function loadAnomalies() {
  const list = $('anomalies-list');
  list.innerHTML = '<div class="empty-state">Loading...</div>';
  try {
    const { anomalies } = await api('GET', '/api/admin/anomalies');
    if (!anomalies.length) {
      list.innerHTML = '<div class="empty-state">✅ No unresolved alerts</div>';
      return;
    }
    list.innerHTML = anomalies.map(a => `
      <div class="anomaly-item ${a.severity === 'critical' ? 'critical' : ''}">
        <div class="anomaly-top">
          <span class="anomaly-type">${a.alert_type.replace(/_/g,' ').toUpperCase()}</span>
          <span class="badge ${a.severity === 'critical' ? 'badge-danger' : a.severity === 'high' ? 'badge-warning' : 'badge-info'}">${a.severity}</span>
        </div>
        <div class="anomaly-meta">User: ${a.username || a.user_id || '—'} · ${new Date(a.created_at).toLocaleString()}</div>
        ${a.details ? `<pre style="font-size:11px;margin-top:8px;color:var(--muted);overflow:auto">${JSON.stringify(JSON.parse(a.details), null, 2)}</pre>` : ''}
        <div style="margin-top:10px">
          <button class="btn-sm" onclick="resolveAlert('${a.id}')">Mark Resolved</button>
        </div>
      </div>
    `).join('');
  } catch(e) {
    list.innerHTML = `<div class="empty-state" style="color:var(--danger)">${e.message}</div>`;
  }
}

async function resolveAlert(id) {
  try {
    await api('PATCH', `/api/admin/anomalies/${id}/resolve`);
    loadAnomalies();
    loadOverview();
  } catch(e) { alert(e.message); }
}
window.resolveAlert = resolveAlert;

// ─── Users ────────────────────────────────────────────────────────────────────
async function loadUsers() {
  const tbody = $('users-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading...</td></tr>';
  try {
    const { users } = await api('GET', '/api/admin/users');
    tbody.innerHTML = users.map(u => `
      <tr>
        <td><strong>${u.username}</strong></td>
        <td style="font-size:12px;color:var(--muted)">${u.email}</td>
        <td><span class="badge ${u.role === 'admin' ? 'badge-accent' : 'badge-info'}">${u.role}</span></td>
        <td style="font-size:11px;color:var(--muted)">${u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
        <td>${u.is_locked ? '<span class="badge badge-danger">Locked</span>' : u.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-warning">Inactive</span>'}</td>
        <td>
          <button class="btn-sm" onclick="toggleLock('${u.id}', ${!u.is_locked})">${u.is_locked ? '🔓 Unlock' : '🔒 Lock'}</button>
        </td>
      </tr>
    `).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--danger)">${e.message}</td></tr>`;
  }
}

async function toggleLock(id, lock) {
  const action = lock ? 'lock' : 'unlock';
  if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} this user?`)) return;
  try {
    await api('PATCH', `/api/admin/users/${id}/lock`, { locked: lock });
    loadUsers();
  } catch(e) { alert(e.message); }
}
window.toggleLock = toggleLock;

// Auto-refresh overview every 30s
setInterval(() => { if (activeTab === 'overview') loadOverview(); }, 30000);

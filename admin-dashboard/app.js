import { ApiError, createApi } from './api.js';
import { button, node, stateCard } from './components.js';
import { createViews } from './views.js';

const $ = id => document.getElementById(id);
const api = createApi();
const pages = {
  overview: ['Organization overview', 'Monitor access, security activity and the health of your control plane.'],
  users: ['Users & roles', 'Manage organization accounts, permissions and sign-in access.'],
  devices: ['Device inventory', 'Review device enrollment, key registration and trust.'],
  sessions: ['Active sessions', 'Monitor current access and terminate sessions when needed.'],
  network: ['VPN health', 'Inspect the connection source used to reach this control plane.'],
  policies: ['URL policies', 'Assign browser rules, inspect revisions and manage URL blocks.'],
  events: ['Security events', 'Explore client reports and server-recorded URL activity.'],
  audit: ['Audit log', 'Review administrative actions and authorization decisions.'],
  alerts: ['Risk & alerts', 'Triage unresolved anomalies reported for this organization.'],
  account: ['Account settings', 'Review your administrator profile and session.'],
};
let active = 'overview';
let identity;
let socket;
let socketToken;
let renderVersion = 0;
let pending = false;
let dialogJob;
const views = createViews({
  api, getAccount: () => identity, showDialog, confirm: confirmAction,
  refresh: () => load(), navigate, signedOut,
});

function message(id, value, type = '') {
  const element = $(id);
  element.hidden = !value;
  element.textContent = value || '';
  element.className = 'message ' + type;
}
function describe(error) {
  if (!(error instanceof ApiError)) return error instanceof TypeError ? 'The control plane is unreachable. Check your connection and try again.' :
    error?.message || 'An unexpected error occurred.';
  return error.message + (error.requestId ? ' Request ID ' + error.requestId + '.' : '');
}
function loading() {
  $('view').replaceChildren(stateCard('Loading ' + pages[active][0].toLowerCase(), 'Fetching organization data.', null, 'loading'));
}

function stopSocket() {
  socket?.disconnect();
  socket = undefined;
  socketToken = undefined;
  setRealtime(false);
}
function setRealtime(ready) {
  $('realtime').textContent = ready ? 'Live updates connected' : 'Updates offline';
  $('realtime').className = 'chip ' + (ready ? 'good' : 'neutral');
}
function startSocket() {
  const token = api.token();
  if (!identity || !token || !window.io || socketToken === token) return;
  stopSocket();
  socketToken = token;
  const connection = window.io({ auth: { token } });
  socket = connection;
  connection.on('connect', () => connection.emit('join_admin', token));
  connection.on('sessions_snapshot', () => { if (connection === socket) setRealtime(true); });
  connection.on('disconnect', () => { if (connection === socket) setRealtime(false); });
  connection.on('connect_error', () => { if (connection === socket) setRealtime(false); });
  const visiblePage = (allowed) => {
    if (connection === socket && allowed.includes(active)) refreshInBackground();
  };
  connection.on('user_logged_in', () => visiblePage(['overview', 'sessions']));
  connection.on('session_terminated', () => visiblePage(['overview', 'sessions']));
  connection.on('url_blocked', () => visiblePage(['policies']));
}

function signedOut(text) {
  renderVersion++;
  pending = false;
  identity = undefined;
  api.clear();
  stopSocket();
  views.reset();
  if ($('dialog').open) $('dialog').close();
  $('view').replaceChildren();
  $('console').hidden = true;
  $('sign-in').hidden = false;
  message('login-message', text);
  $('login').elements.username.focus();
}
async function signIn(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.dataset.pending) return;
  const { username, password, organizationId } = Object.fromEntries(new FormData(form));
  form.elements.password.value = '';
  form.dataset.pending = 'true';
  form.querySelector('[type=submit]').disabled = true;
  message('login-message', '');
  try {
    await api.login({ username: username.trim(), password, ...(organizationId.trim() && { organizationId: organizationId.trim() }) });
    const { account } = await api.request('/admin/account');
    const { organization } = await api.request('/organization');
    identity = account;
    $('account-name').textContent = account.username;
    $('account-role').textContent = account.role === 'superadmin' ? 'Superadmin' : 'Administrator';
    $('avatar').textContent = account.username.slice(0, 2).toUpperCase();
    $('org-name').textContent = organization.name;
    $('sign-in').hidden = true;
    $('console').hidden = false;
    // Clear login inputs before authenticated views can receive focus.
    form.reset();
    setPage(readLocation(), true);
  } catch (error) {
    if (api.token()) await api.logout().catch(() => {});
    message('login-message', error.status === 403 ? 'Administrator access is required. ' + describe(error) : describe(error), 'danger');
  } finally {
    form.querySelector('[type=submit]').disabled = false;
    delete form.dataset.pending;
  }
}

function readLocation() {
  const name = window.location.hash.slice(1);
  return Object.hasOwn(pages, name) ? name : 'overview';
}
function navigate(page) {
  if (window.location.hash !== '#' + page) window.location.hash = page;
  else setPage(page, true);
}
function setPage(page, focus = false) {
  if (!identity) return;
  active = page;
  const [title, description] = pages[page];
  $('page-title').textContent = title;
  $('page-description').textContent = description;
  for (const link of document.querySelectorAll('[data-page]')) {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('menu').setAttribute('aria-expanded', 'false');
  $('nav').classList.remove('open');
  message('notification', '');
  if (focus) $('page-title').focus();
  load();
}
async function load({ quiet = false } = {}) {
  if (!identity) return;
  const version = ++renderVersion;
  pending = true;
  $('view').setAttribute('aria-busy', 'true');
  if (!quiet) loading();
  try {
    const view = await views[active]();
    if (version === renderVersion) $('view').replaceChildren(view);
  } catch (error) {
    if (version !== renderVersion) return;
    if (error.status === 401 || !api.token()) {
      signedOut('Your session ended. Sign in again.');
      return;
    }
    const denied = error.status === 403;
    $('view').replaceChildren(stateCard(denied ? 'Access denied' : 'Unable to load this view', describe(error),
      button('Retry', () => load(), 'subtle', 'refresh'), denied ? 'denied' : 'error'));
  } finally {
    if (version === renderVersion) {
      pending = false;
      $('view').setAttribute('aria-busy', 'false');
      startSocket();
    }
  }
}
function refreshInBackground() {
  if (!identity || pending || document.hidden || $('dialog').open || $('view').contains(document.activeElement)) return;
  load({ quiet: true });
}

function showDialog(options) {
  dialogJob = options;
  $('dialog-title').textContent = options.title;
  $('dialog-body').replaceChildren(...options.content);
  $('dialog-actions').hidden = !options.run;
  $('dialog-submit').textContent = options.submit || 'Save';
  $('dialog-submit').disabled = false;
  $('dialog-cancel').disabled = false;
  $('dialog-close').disabled = false;
  message('dialog-message', '');
  $('dialog').showModal();
}
function confirmAction({ title, detail, submit, run }) {
  showDialog({ title, content: [node('p', {}, detail)], submit, run });
}
$('dialog-form').addEventListener('submit', async event => {
  event.preventDefault();
  const job = dialogJob;
  if (!job?.run || $('dialog-submit').disabled) return;
  const values = new FormData(event.currentTarget);
  $('dialog-submit').disabled = true;
  $('dialog-cancel').disabled = true;
  $('dialog-close').disabled = true;
  message('dialog-message', '');
  try {
    await job.run(values);
    if (!$('dialog').open) return;
    $('dialog').close();
    message('notification', 'Changes saved.', 'good');
  } catch (error) {
    if (error.status === 401 || !api.token()) {
      signedOut('Your session ended. Sign in again.');
      return;
    }
    message('dialog-message', describe(error), 'danger');
  } finally {
    $('dialog-submit').disabled = false;
    $('dialog-cancel').disabled = false;
    $('dialog-close').disabled = false;
  }
});
$('dialog').addEventListener('cancel', event => { if ($('dialog-submit').disabled) event.preventDefault(); });
$('dialog').addEventListener('close', () => {
  dialogJob = undefined;
  $('dialog-body').replaceChildren();
  message('dialog-message', '');
});
$('dialog-close').addEventListener('click', () => $('dialog').close());
$('dialog-cancel').addEventListener('click', () => $('dialog').close());
$('login').addEventListener('submit', signIn);
$('refresh').addEventListener('click', () => { message('notification', ''); load(); });
$('logout').addEventListener('click', async () => {
  const control = $('logout');
  control.disabled = true;
  try { await api.logout(); signedOut('Signed out.'); }
  catch { signedOut('Signed out locally. The server could not confirm session revocation.'); }
  finally { control.disabled = false; }
});
$('menu').addEventListener('click', () => {
  const open = $('nav').classList.toggle('open');
  $('menu').setAttribute('aria-expanded', String(open));
});
window.addEventListener('hashchange', () => {
  if (window.location.hash !== '#main') setPage(readLocation(), true);
});
setInterval(() => { if (active === 'overview' || active === 'sessions') refreshInBackground(); }, 90000);

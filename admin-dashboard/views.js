import { actions, activityChart, button, chip, code, count, definition, field, icon, input,
  moment, muted, node, panel, select, stateCard, table } from './components.js';
import { createGovernanceViews } from './governance.js';

const PAGE_SIZE = 25;
const severity = value => chip(value, { critical: 'danger', high: 'danger', medium: 'warning', low: 'blue' }[value]);
const yes = (value, on = 'Yes', off = 'No') => chip(value ? on : off, value ? 'good' : 'neutral');
const person = (name, detail) => node('div', { class: 'person' }, node('strong', {}, name || '—'), detail ? muted(detail) : null);
const short = value => value ? code(value.slice(0, 8)) : muted('—');
const textArea = (name, value) => node('textarea', { name, rows: 4, maxlength: '8500' }, value);
const lines = value => String(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const filters = (children, onsubmit) => node('form', { class: 'filters', onsubmit },
  children, node('button', { type: 'submit', class: 'btn' }, 'Apply filters'));

function metric(label, value, description, symbol, tone) {
  return node('article', { class: 'metric' }, node('div', { class: 'metric-top' }, label,
    node('span', { class: 'metric-icon ' + tone }, icon(symbol))),
  node('strong', { class: 'metric-value' }, count(value)), node('p', {}, description));
}

function pager(data, move) {
  return node('div', { class: 'pager' },
    button('Previous', () => move(data.page - 1), data.page === 1 ? 'inactive' : ''),
    node('span', {}, 'Page ' + data.page), button('Next', () => move(data.page + 1), data.more ? '' : 'inactive'));
}

export function createViews({ api, getAccount, showDialog, confirm, refresh, navigate, signedOut }) {
  const pageState = new Map();
  function state(key) {
    if (!pageState.has(key)) pageState.set(key, { page: 1, params: {} });
    return pageState.get(key);
  }
  async function list(key, path, property) {
    const current = state(key);
    const query = new URLSearchParams({ page: current.page, limit: PAGE_SIZE, ...current.params });
    const data = await api.request(path + '?' + query);
    const rows = data[property];
    return { rows, page: current.page, more: data.total !== undefined ? current.page * PAGE_SIZE < data.total : rows.length === PAGE_SIZE, extra: data };
  }
  const controls = (key, data) => {
    const pagerNode = pager(data, page => { state(key).page = page; refresh(); });
    pagerNode.querySelectorAll('.inactive').forEach(control => { control.disabled = true; });
    return pagerNode;
  };
  function filterForm(key, fields) {
    return filters(fields, event => {
      event.preventDefault();
      const params = Object.fromEntries([...new FormData(event.currentTarget)].filter(([, value]) => value !== ''));
      pageState.set(key, { page: 1, params });
      refresh();
    });
  }
  function action(label, title, detail, path, method = 'POST', body) {
    return button(label, () => confirm({ title, detail, submit: label, async run() {
      await api.request(path, { method, body });
      refresh();
    } }), 'subtle');
  }
  function canManage(row, allowSelf = false) {
    const actor = getAccount();
    if ((row.user_id || row.id) === actor.id) return allowSelf;
    return row.role !== 'superadmin' && (row.role !== 'admin' || actor.role === 'superadmin');
  }
  const auditTable = entries => table('Audit entries', ['Action', 'Actor', 'Target', 'Request ID', 'Time'],
    entries.map(entry => [node('strong', {}, entry.action), entry.actor || 'System', code(entry.target), code(entry.request_id), moment(entry.created_at)]));

  function networkStatus(data) {
    return definition([
      ['Source enforcement', chip(data.sourceGate === 'accepted' ? 'Source accepted' : 'Gate disabled',
        data.sourceGate === 'accepted' ? 'good' : 'warning')],
      ['Observed source', code(data.observedAddress)],
      ['Source mode', data.sourceMode === 'egress' ? 'Dedicated egress addresses' : 'Tunnel subnet'],
    ]);
  }

  async function overview() {
    const [organization, stats, series, network, audit] = await Promise.all([
      api.request('/organization'), api.request('/admin/stats'), api.request('/admin/security-summary'),
      api.request('/admin/network-health'), api.request('/admin/audit-log?limit=5'),
    ]);
    const org = organization.organization;
    return node('div', { class: 'stack' },
      node('div', { class: 'metric-grid' },
        metric('Active sessions', stats.activeSessions, 'Open organization sessions', 'session', 'blue'),
        metric('Active users', stats.unlockedUsers, 'Enabled organization accounts', 'users', 'cyan'),
        metric('Flagged requests', stats.flaggedLogs24h, 'Policy blocks in the last 24 hours', 'pulse', 'violet'),
        metric('Open alerts', stats.unresolvedAlerts, 'Anomalies awaiting review', 'alert', 'amber')),
      node('div', { class: 'overview-grid' },
        panel('Security activity', 'Daily totals across seven UTC dates', activityChart(series.days), chip('7 days UTC', 'neutral')),
        panel('Organization status', org.name, node('div', { class: 'panel-body' },
          definition([['Organization', yes(org.is_active, 'Active', 'Inactive')]]), networkStatus(network),
          button('View VPN health', () => navigate('network'), 'link-button', 'arrow')))),
      panel('Recent audit events', 'Server records of sign-ins and administrative actions',
        auditTable(audit.entries), button('Open audit log', () => navigate('audit'), 'subtle', 'arrow')));
  }

  async function users() {
    const data = await list('users', '/admin/users', 'users');
    const add = () => showDialog({ title: 'Create organization user', submit: 'Create user',
      content: [
        field('Username', input('username', { required: true, minlength: 3, maxlength: 80, pattern: '[A-Za-z0-9]+' })),
        field('Email', input('email', { type: 'email', maxlength: 255, required: true })),
        field('Initial password', input('password', { type: 'password', autocomplete: 'new-password', required: true, minlength: 12, maxlength: 72 })),
        node('p', { class: 'muted' }, 'Use 12–72 bytes with uppercase, lowercase, a digit and one of @$!%*?&.'),
      ], async run(form) {
        await api.request('/users', { method: 'POST', body: Object.fromEntries(form) });
        state('users').page = 1;
        refresh();
      },
    });
    const roleChange = row => () => showDialog({ title: 'Change role for ' + row.username, submit: 'Change role',
      content: [field('New role', select('role', [['user', 'User'], ['admin', 'Administrator']], row.role)),
        node('p', { class: 'muted' }, 'Changing the role revokes the user’s active sessions.')],
      async run(form) {
        await api.request('/admin/users/' + row.id + '/role', { method: 'PATCH', body: { role: form.get('role') } });
        refresh();
      },
    });
    return panel('Organization users', 'Search by username or email.', node('div', {},
      filterForm('users', [field('Search users', input('q', { maxlength: 80, value: state('users').params.q || '', type: 'search' }))]),
      table('Organization users', ['User', 'Role', 'Status', 'Last sign-in', 'Actions'], data.rows.map(row => [
        person(row.username, row.email), chip(row.role, row.role === 'user' ? 'neutral' : 'blue'),
        row.is_locked ? chip('Locked', 'warning') : yes(row.is_active, 'Active', 'Disabled'), moment(row.last_login),
        canManage(row) ? actions(
          getAccount().role === 'superadmin' && button('Change role', roleChange(row), 'subtle'),
          action(row.is_locked ? 'Unlock' : 'Lock', (row.is_locked ? 'Unlock ' : 'Lock ') + row.username + '?',
            row.is_locked ? 'The account can sign in again. Previous sessions stay revoked.' : 'The account is locked and its sessions are revoked.',
            '/admin/users/' + row.id + '/lock', 'PATCH', { locked: !row.is_locked }),
        ) : muted('—'),
      ])), controls('users', data)), button('Create user', add, 'primary', 'plus'));
  }

  async function devices() {
    const data = await list('devices', '/admin/devices', 'devices');
    const trust = row => () => showDialog({ title: 'Review ' + row.name, submit: 'Update trust',
      content: [field('Trust state', select('trustState', [['approved', 'Approve for 1 hour'], ['quarantined', 'Quarantine'], ['unknown', 'Needs review']], row.trust_state)),
        node('p', { class: 'muted' }, 'Approval is an administrator attestation. It requires an enrolled key and expires after one hour.')],
      async run(form) {
        const trustState = form.get('trustState');
        const reason = { approved: 'operator_verified', quarantined: 'noncompliant', unknown: 'review_required' }[trustState];
        await api.request('/admin/devices/' + row.id + '/trust', { method: 'PATCH',
          body: { trustState, reason, ...(trustState === 'approved' && { validForSeconds: 3600 }) } });
        refresh();
      },
    });
    return panel('Device inventory', 'Registered devices and organization trust decisions.', node('div', {},
      filterForm('devices', [field('Enrollment status', select('status', [['', 'All statuses'], ['registered', 'Registered'], ['revoked', 'Revoked']], state('devices').params.status))]),
      table('Device inventory', ['Device', 'Platform', 'Enrollment', 'Trust', 'Trust expires', 'Actions'], data.rows.map(row => [
        person(row.name, row.username), row.platform,
        row.status === 'revoked' ? chip('Revoked', 'danger') : yes(row.key_enrolled, 'Key enrolled', 'Awaiting key'),
        chip(row.trust_state === 'approved' && Date.parse(row.posture_valid_until) <= Date.now() ? 'Approval expired' : row.trust_state,
          row.trust_state === 'approved' && Date.parse(row.posture_valid_until) > Date.now() ? 'good' : 'neutral'),
        moment(row.posture_valid_until), row.status === 'revoked' || !canManage(row, true) ? muted('—') : actions(
          button('Review trust', trust(row), 'subtle'),
          action('Revoke', 'Revoke ' + row.name + '?', 'This revokes the app registration and its sessions. Revoke the WireGuard peer separately at the gateway.',
            '/admin/devices/' + row.id + '/trust', 'PATCH', { trustState: 'revoked', reason: 'review_required' }),
        ),
      ])), controls('devices', data)));
  }

  async function sessions() {
    const data = await list('sessions', '/admin/sessions', 'sessions');
    return panel('Active sessions', 'Organization sessions with a currently valid access window.', node('div', {},
      table('Active sessions', ['User', 'Device OS', 'Observed IP', 'Last activity', 'Expires', 'Actions'], data.rows.map(row => [
        person(row.username, row.email), row.device_os || '—', code(row.vpn_ip), moment(row.last_activity), moment(row.expires_at),
        canManage(row, true) ? action('Terminate', 'Terminate session for ' + row.username + '?',
          'The session and its refresh credential will be revoked.', '/admin/force-logout', 'POST', { sessionId: row.id }) : muted('—'),
      ])), controls('sessions', data)));
  }

  async function network() {
    const [networkData, readiness] = await Promise.all([api.request('/admin/network-health'), api.request('/ready').then(() => true, () => false)]);
    const observations = networkData.observations;
    const gateway = networkData.gateway;
    const messages = {
      not_configured: ['Gateway feed is not configured', 'An operator can publish a read-only WireGuard status snapshot.'],
      unavailable: ['Gateway feed unavailable', 'The configured snapshot could not be read or validated.'],
      stale: ['Gateway feed is stale', 'The last snapshot is outside the two-minute reporting window.'],
    };
    const gatewayView = gateway.state === 'available' ? node('div', { class: 'panel-body' },
      definition([['Matched organization peers', count(gateway.enrolled)], ['Active peers in registry', count(gateway.active)],
        ['Active peers configured', count(gateway.configured)], ['Recent handshakes (3 minutes)', count(gateway.recent)],
        ['Snapshot age', gateway.sampleAgeSeconds + ' seconds']]),
      node('p', { class: 'muted' }, 'A recent handshake shows peer activity. Check routes and DNS separately.')) :
      stateCard(...messages[gateway.state]);
    return node('div', { class: 'stack' },
      node('div', { class: 'overview-grid' },
        panel('Console connection', 'Network observations at the control-plane boundary.', node('div', { class: 'panel-body' },
          definition([['API and database', yes(readiness, 'Ready', 'Unavailable')]]), networkStatus(networkData))),
        panel('Browser source observations', 'Recorded URL decisions over the last 24 hours.', node('div', { class: 'panel-body' },
          definition([['Observed requests', count(observations.observed)], ['Source gate accepted', count(observations.accepted)],
            ['Latest accepted request', moment(observations.last_accepted)]])))),
      panel('WireGuard peer activity', 'Only peers matched to devices in the current organization are counted.', gatewayView));
  }

  function policyEditor(policy) {
    return async () => {
      const initial = policy?.assignment || { scope: 'organization', userIds: [] };
      const selected = new Set(initial.userIds);
      const scope = select('assignment', [['organization', 'Entire organization'], ['users', 'Selected users'], ['groups', 'Directory groups']], initial.scope);
      const groupPicker = node('fieldset', { class: 'picker', hidden: scope.value !== 'groups' }, node('legend', {}, 'Assigned groups'),
        field('Group IDs, one per line', textArea('groupIds', (initial.groupIds || []).join('\n'))), muted('Find group IDs on the Integrations page.'));
      const search = input('userSearch', { maxlength: 80, type: 'search' });
      const matches = node('div', { class: 'picker-list' });
      const assigned = node('div', { class: 'picker-selected' });
      const names = new Map();
      function showSelected() {
        assigned.replaceChildren(node('p', { class: 'muted' }, selected.size ? selected.size + ' assigned' : 'No users selected'),
          ...[...selected].map(id => button('Remove ' + (names.get(id) || id), () => {
            selected.delete(id); showSelected();
            const checkbox = matches.querySelector('[value="' + id + '"]');
            if (checkbox) checkbox.checked = false;
          }, 'subtle')));
      }
      let queryVersion = 0;
      async function findUsers() {
        const version = ++queryVersion;
        matches.replaceChildren(muted('Searching users…'));
        try {
          const query = new URLSearchParams({ limit: 20 });
          if (search.value.trim()) query.set('q', search.value.trim());
          const { users } = await api.request('/admin/users?' + query);
          if (version !== queryVersion) return;
          matches.replaceChildren(...users.map(user => {
            names.set(user.id, user.username);
            const control = input('member', { type: 'checkbox', value: user.id, checked: selected.has(user.id) });
            control.addEventListener('change', () => {
              if (control.checked) selected.add(user.id);
              else selected.delete(user.id);
              showSelected();
            });
            return node('label', { class: 'check-label' }, control, user.username);
          }), users.length ? muted('Showing up to 20 matches.') : muted('No matching users.'));
          showSelected();
        } catch (error) {
          if (version === queryVersion) matches.replaceChildren(muted(error.status === 403 ? 'User search is not permitted.' : 'User search unavailable.'));
        }
      }
      const picker = node('fieldset', { class: 'picker', hidden: scope.value !== 'users' },
        node('legend', {}, 'Assigned users'), node('div', { class: 'search-row' }, field('Find by name or email', search),
          button('Find users', findUsers)), matches, assigned);
      scope.addEventListener('change', () => {
        picker.hidden = scope.value !== 'users';
        groupPicker.hidden = scope.value !== 'groups';
        if (!picker.hidden) findUsers();
      });
      search.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); findUsers(); } });
      showSelected();
      showDialog({ title: policy ? 'Edit URL policy' : 'Create URL policy', submit: policy ? 'Save revision' : 'Create policy',
        content: [field('Policy name', input('name', { maxlength: 160, required: true, value: policy?.name })),
          field('Deny patterns, one per line', textArea('deny', policy?.rules.deny.join('\n') || '')),
          field('Allow patterns, one per line', textArea('allow', policy?.rules.allow.join('\n') || '')),
          node('p', { class: 'muted' }, 'Use * as a wildcard. Deny matches win. A populated allow list requires a match.'),
          field('Assignment', scope), picker, groupPicker,
          node('label', { class: 'check-label' }, input('active', { type: 'checkbox', checked: policy?.is_active ?? true }), 'Policy active')],
        async run(form) {
          const userIds = scope.value === 'users' ? [...selected] : [];
          if (scope.value === 'users' && !userIds.length) throw new Error('Select at least one user.');
          const body = { name: form.get('name').trim(), rules: { deny: lines(form.get('deny')), allow: lines(form.get('allow')) },
            isActive: form.has('active'), assignment: { scope: scope.value, userIds, ...(scope.value === 'groups' && { groupIds: lines(form.get('groupIds')) }) }, ...(policy && { revision: policy.revision }) };
          if (new TextEncoder().encode(JSON.stringify(body)).length > 10240) throw new Error('Reduce the rule or assignment lists to fit the 10 KiB request limit.');
          await api.request(policy ? '/policies/' + policy.id : '/policies', { method: policy ? 'PUT' : 'POST', body });
          refresh();
        },
      });
      if (!picker.hidden) findUsers();
    };
  }

  function policyHistory(policy) {
    return () => {
      const history = node('div', { class: 'history' }, stateCard('Loading revisions', 'Fetching the policy history.', null, 'loading'));
      async function load(page) {
        try {
          const { versions } = await api.request('/admin/policies/' + policy.id + '/versions?page=' + page + '&limit=20');
          history.replaceChildren(...versions.map(version => node('details', { class: 'version-entry' },
            node('summary', {}, 'Revision ' + version.revision + ' · ' + version.name),
            definition([['Saved', moment(version.created_at)], ['Actor', version.actor || 'Migration'],
              ['State', version.is_active ? 'Active' : 'Disabled'], ['Assignment', version.assignment.scope === 'organization' ? 'Entire organization' :
                (version.assignment.groupIds || version.assignment.userIds).map(id => code(id))],
              ['Deny', version.rules.deny.join(', ') || 'None'], ['Allow', version.rules.allow.join(', ') || 'None']]))),
          versions.length ? nullText() : stateCard('No recorded revisions', 'Revisions appear here after a policy is saved.'),
          actions(page > 1 && button('Previous revisions', () => load(page - 1)),
            versions.length === 20 && button('Older revisions', () => load(page + 1))));
        } catch (error) {
          history.replaceChildren(stateCard('History unavailable', error.message, button('Retry', () => load(page)), 'error'));
        }
      }
      showDialog({ title: 'History for ' + policy.name, content: [history] });
      load(1);
    };
  }

  async function policies() {
    const [data, blocks] = await Promise.all([list('policies', '/admin/policies', 'policies'), list('blocks', '/admin/blocked-urls', 'blockedUrls')]);
    const legacyAdd = () => showDialog({ title: 'Add organization-wide block', submit: 'Block URL',
      content: [field('URL or host pattern', input('pattern', { required: true, maxlength: 500 })),
        field('Reason', input('reason', { maxlength: 255 }))],
      async run(form) {
        const reason = form.get('reason').trim();
        await api.request('/admin/blocked-urls', { method: 'POST', body: { pattern: form.get('pattern').trim(), ...(reason && { reason }) } });
        refresh();
      },
    });
    return node('div', { class: 'stack' },
      panel('Versioned URL policies', 'Manage explicit organization or user assignments.', node('div', {},
        table('URL policies', ['Policy', 'Assignment', 'Revision', 'Status', 'Actions'], data.rows.map(row => [
          person(row.name, row.rules.deny.length + ' deny · ' + row.rules.allow.length + ' allow'),
          row.assignment.scope === 'groups' ? chip(row.assignment.groupIds.length + (row.assignment.groupIds.length === 1 ? ' assigned group' : ' assigned groups'), 'blue') :
            row.assignment.scope === 'users' ? chip(row.assignment.userIds.length + (row.assignment.userIds.length === 1 ? ' assigned user' : ' assigned users'), 'blue') : 'Entire organization',
          'v' + row.revision, yes(row.is_active, 'Active', 'Disabled'),
          actions(button('Edit', policyEditor(row), 'subtle'), button('History', policyHistory(row), 'subtle')),
        ])), controls('policies', data)), button('Create policy', policyEditor(), 'primary', 'plus')),
      panel('URL block list', 'Organization-wide rules from the original URL controls.', node('div', {},
        table('Organization URL blocks', ['Pattern', 'Reason', 'Created', 'Actions'], blocks.rows.map(row => [
          code(row.pattern), row.reason || '—', moment(row.created_at),
          action('Unblock', 'Remove this URL block?', row.pattern, '/admin/blocked-urls/' + row.id, 'DELETE'),
        ])), controls('blocks', blocks)), button('Block URL', legacyAdd, 'subtle', 'plus')));
  }

  async function events() {
    const selected = state('events').params;
    const ip = state('ip').params;
    const [data, logs] = await Promise.all([list('events', '/events', 'events'), list('ip', '/admin/ip-logs', 'logs')]);
    return node('div', { class: 'stack' },
      panel('Reported security events', 'Client-submitted signals. Treat these reports as unverified.', node('div', {},
        filterForm('events', [field('Severity', select('severity', [['', 'Any severity'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], selected.severity)),
          field('Event type', input('eventType', { value: selected.eventType, maxlength: 80, pattern: '[a-z][a-z0-9_.]{0,79}' }))]),
        table('Security events', ['Event', 'Severity', 'User ID', 'Device ID', 'Occurred'], data.rows.map(row => [
          row.event_type, severity(row.severity), short(row.user_id), short(row.device_id), moment(row.occurred_at),
        ])), controls('events', data))),
      panel('URL and IP activity', 'Server records from the navigation endpoint.', node('div', {},
        filterForm('ip', [field('Outcome', select('flagged', [['', 'All requests'], ['true', 'Flagged'], ['false', 'Unflagged']], ip.flagged))]),
        table('URL and IP activity', ['User', 'Observed IP', 'Source gate', 'URL', 'Country', 'Outcome', 'Time'], logs.rows.map(row => [
          row.username || '—', code(row.request_ip), yes(row.vpn_confirmed, 'Accepted', 'Not recorded'),
          code(row.url_requested), row.country_code || '—', row.flagged ? chip(row.flag_reason || 'Flagged', 'warning') : chip('Allowed', 'neutral'),
          moment(row.created_at),
        ])), controls('ip', logs))));
  }

  async function audit() {
    const [entries, decisions] = await Promise.all([list('audit', '/admin/audit-log', 'entries'), list('decisions', '/admin/access-decisions', 'decisions')]);
    return node('div', { class: 'stack' },
      panel('Audit trail', 'Recorded administrative actions and identity events.', node('div', {},
        filterForm('audit', [field('Action code', input('action', { value: state('audit').params.action, maxlength: 100, pattern: '[a-z][a-z0-9_.]{0,99}' }))]),
        auditTable(entries.rows), controls('audit', entries))),
      panel('Access decisions', 'Server authorization results with request correlation.', node('div', {},
        table('Server access decisions', ['Resource', 'Outcome', 'Reason', 'User ID', 'Request ID', 'Time'], decisions.rows.map(row => [
          row.resource, yes(row.outcome === 'allow', 'Allowed', 'Denied'), row.reason, short(row.user_id), code(row.request_id), moment(row.created_at),
        ])), controls('decisions', decisions))));
  }

  async function alerts() {
    const [data, detector] = await Promise.all([list('alerts', '/admin/alerts', 'alerts'), api.request('/admin/detection-rules')]);
    const selected = state('alerts').params;
    return node('div', { class: 'stack' },
      panel('Detection health', 'Deterministic rules with recorded evidence. Confidence measures the signal, not whether an account is compromised.',
        node('div', { class: 'panel-body' }, definition([['Worker', chip(detector.health, detector.health === 'healthy' ? 'good' : 'warning')],
          ['Last successful scan', moment(detector.lastSuccess)], ['Scan interval', detector.intervalMs / 1000 + ' seconds']]),
        node('details', {}, node('summary', {}, 'Rule definitions'), ...detector.rules.map(rule => node('p', {},
          node('strong', {}, rule.id + ' v' + rule.version + ' · ' + rule.severity + ' · ' + rule.confidence + ' confidence'),
          ' · Threshold ' + rule.threshold + ' in ' + rule.window + 's. ' + rule.explanation))))),
      panel('Security incidents', 'Review observations before taking manual action. Client reports are unverified.', node('div', {},
        filterForm('alerts', [field('Incident status', select('status', [['open', 'Open'], ['investigating', 'Investigating'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'], ['all', 'All statuses']], selected.status || 'open')),
          field('Severity', select('severity', [['', 'Any severity'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], selected.severity)),
          field('Detection rule', select('ruleId', [['', 'Any rule'], ...detector.rules.map(rule => [rule.id, rule.id])], selected.ruleId))]),
        table('Security incidents', ['Rule', 'Severity / confidence', 'Account', 'Status', 'Evidence', 'Last observed', 'Actions'], data.rows.map(row => [
          person(row.rule_id || row.alert_type, row.explanation), node('div', {}, severity(row.severity), muted(row.confidence + ' confidence')),
          row.username || 'Unattributed', chip(row.status, 'blue'), String(row.evidence_count), moment(row.last_seen),
          button('Review', () => openIncident(row.id), 'subtle'),
        ]), 'No incidents match these filters'), controls('alerts', data))));
  }

  async function openIncident(id) {
    const content = node('div', { class: 'stack' });
    showDialog({ title: 'Incident review', content: [content] });
    async function load(kind, page = 1) {
      const body = await api.request('/admin/alerts/' + id + '/' + kind + '?limit=20&page=' + page);
      const rows = body[kind];
      const host = content.querySelector('[data-history="' + kind + '"]');
      host.replaceChildren(kind === 'evidence' ? table('Incident evidence', ['Event', 'Trust', 'Reason', 'Request ID', 'Observed'], rows.map(row => [
        row.event_type, row.trust, row.reason || '—', code(row.request_id), moment(row.observed_at),
      ]), 'No recorded evidence') : table('Incident review history', ['Status', 'Disposition', 'Actor', 'Response', 'Time'], rows.map(row => [
        row.status, row.disposition, code(row.actor_id), row.response || 'Review', moment(row.created_at),
      ]), 'No reviews yet'),
        actions(page > 1 && button('Newer ' + kind, () => load(kind, page - 1).catch(failed)),
          rows.length === 20 && button('Older ' + kind, () => load(kind, page + 1).catch(failed))));
    }
    function failed(error) { content.replaceChildren(stateCard('Incident unavailable', error.message, null, 'error')); }
    try {
      const { alert } = await api.request('/admin/alerts/' + id);
      const reviewStatus = select('status', [['open', 'Open'], ['investigating', 'Investigating'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed']], alert.status);
      const disposition = select('disposition', [['pending', 'Pending'], ['confirmed', 'Confirmed'], ['benign', 'Benign'], ['insufficient_evidence', 'Insufficient evidence']], alert.disposition);
      const save = button('Save review', async () => {
        save.disabled = true;
        try {
          await api.request('/admin/alerts/' + id + '/review', { method: 'PATCH', body: { revision: alert.review_revision, status: reviewStatus.value, disposition: disposition.value } });
          await openIncident(id); refresh();
        } catch (error) { failed(error); }
      }, 'primary');
      const respond = action => confirm({ title: action === 'lock_user' ? 'Lock the associated account?' : 'Terminate the associated session?',
        detail: 'This is a manual containment action. Authentication failures identify an account target, not the person who attempted access. Existing role restrictions apply.',
        submit: 'Confirm response', async run() {
          await api.request('/admin/alerts/' + id + '/respond', { method: 'POST', body: { revision: alert.review_revision, action } }); refresh();
        } });
      content.replaceChildren(node('p', {}, alert.explanation), definition([['Rule', alert.rule_id || 'Legacy'], ['Confidence', alert.confidence],
        ['Evidence observations', String(alert.evidence_count)], ['Review revision', String(alert.review_revision)]]),
      !alert.rule_id && alert.details ? node('details', {}, node('summary', {}, 'Legacy alert details'),
        node('pre', { class: 'alert-details', tabindex: '0', 'aria-label': 'Legacy alert details' }, JSON.stringify(alert.details, null, 2))) : nullText(),
      field('Review status', reviewStatus), field('Disposition', disposition), save,
      actions(!alert.resolved && alert.user_id && button('Lock account', () => respond('lock_user'), 'danger'),
        !alert.resolved && alert.session_id && button('Terminate session', () => respond('terminate_session'), 'danger')),
      node('h3', {}, 'Detection evidence'), node('div', { 'data-history': 'evidence' }),
      node('h3', {}, 'Review history'), node('div', { 'data-history': 'reviews' }));
      await Promise.all([load('evidence'), load('reviews')]);
    } catch (error) { failed(error); }
  }

  async function account() {
    const { account, session } = await api.request('/admin/account');
    return node('div', { class: 'overview-grid' },
      panel('Administrator profile', 'Your current organization account.', node('div', { class: 'panel-body' },
        definition([['Username', account.username], ['Email', account.email], ['Role', chip(account.role, 'blue')], ['Last sign-in', moment(account.last_login)]]))),
      panel('Session & password', 'Current authentication details.', node('div', { class: 'panel-body' },
        definition([['Authentication', session.authenticationMethod], ['MFA assurance', yes(session.mfaVerified, 'Verified', 'Not asserted')],
          ['Session expires', moment(session.expiresAt)]]),
        session.authenticationMethod === 'password' ? button('Change password', () => showDialog({
          title: 'Change administrator password', submit: 'Change password',
          content: [field('Current password', input('currentPassword', { type: 'password', autocomplete: 'current-password', maxlength: 72, required: true })),
            field('New password', input('newPassword', { type: 'password', autocomplete: 'new-password', minlength: 12, maxlength: 72, required: true })),
            node('p', { class: 'muted' }, 'Use 12–72 bytes with uppercase, lowercase, a digit and one of @$!%*?&. All sessions are revoked after the change.')],
          async run(form) {
            await api.request('/admin/account/password', { method: 'PUT', body: Object.fromEntries(form) });
            signedOut('Password changed. Sign in again.');
          },
        }), 'primary') : node('p', { class: 'muted' }, 'Manage your password with your identity provider.'))));
  }
  return { overview, users, devices, sessions, network, policies, events, audit, alerts, account,
    ...createGovernanceViews({ api, getAccount, showDialog, confirm, refresh, list, controls }), reset: () => pageState.clear() };
}

function nullText() { return document.createTextNode(''); }

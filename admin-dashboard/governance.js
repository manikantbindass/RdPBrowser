import { actions, button, chip, code, definition, field, input, moment, muted, node, panel, select, stateCard, table } from './components.js';

export function createGovernanceViews({ api, getAccount, showDialog, confirm, refresh, list, controls }) {
  const superadmin = () => getAccount()?.role === 'superadmin';
  async function mutate(path, method, body) { return api.request(path, { method, body }); }
  function confirmChange(label, title, detail, path, method, body) {
    return button(label, () => confirm({ title, detail, submit: label, async run() {
      await mutate(path, method, body); refresh();
    } }), 'subtle');
  }

  async function integrations() {
    const [oidc, directories, groups] = await Promise.all([
      api.request('/admin/integrations/oidc'), list('directories', '/admin/integrations/directories', 'directories'),
      list('directory-groups', '/admin/integrations/groups', 'groups'),
    ]);
    const providerOptions = [['', 'No provider'], ...oidc.providers.map(provider => [provider.id, provider.id])];
    const createDirectory = () => showDialog({ title: 'Add directory', submit: 'Add directory',
      content: [field('Directory name', input('name', { required: true, maxlength: 160 })),
        field('SSO provider', select('providerId', providerOptions)),
        node('label', { class: 'check-label' }, input('ssoLinking', { type: 'checkbox' }), 'Allow verified subject linking')],
      async run(form) {
        await mutate('/admin/integrations/directories', 'POST', { name: form.get('name').trim(),
          ...(form.get('providerId') && { providerId: form.get('providerId') }), ssoLinking: form.has('ssoLinking') }); refresh();
      },
    });
    return node('div', { class: 'stack' },
      panel('SSO providers', 'Issuer, callback and claims come from operator configuration.', node('div', {},
        table('Configured SSO providers', ['Provider', 'Issuer', 'Status', 'Validated', 'Actions'], oidc.providers.map(provider => [
          provider.id + ' · ' + provider.kind, code(provider.issuer), chip(provider.status), moment(provider.validatedAt),
          superadmin() ? actions(confirmChange('Validate', 'Validate OIDC discovery?',
            'Check the configured issuer, HTTPS endpoints, PKCE, signing algorithm and client authentication method.',
            '/admin/integrations/oidc/' + provider.id + '/validate', 'POST'),
          (provider.enabled || provider.status === 'validated_disabled') && confirmChange(provider.enabled ? 'Disable' : 'Enable',
            provider.enabled ? 'Disable this provider?' : 'Enable this provider?', 'The change applies to this configured provider and is audited.',
            '/admin/integrations/oidc/' + provider.id + '/state', 'PUT', { revision: provider.revision, enabled: !provider.enabled })) : muted('Superadmin required'),
        ]), 'No configured identity providers'))),
      panel('Directory provisioning', 'Create and rotate credentials for individual directories.', node('div', {},
        definition([['SCIM transport', directories.extra.scimEnabled ? 'Enabled' : 'Disabled'], ['Tenant endpoint', code(directories.extra.baseUrl)]]),
        table('Directory connections', ['Directory', 'Provider', 'State', 'Subject linking', 'Actions'], directories.rows.map(directory => [
          directory.name, directory.providerId || '—', chip(directory.isActive ? 'Active' : 'Disabled'), directory.ssoLinking ? 'Enabled' : 'Disabled',
          actions(button('Credentials', () => credentials(directory), 'subtle'), superadmin() && confirmChange(directory.isActive ? 'Disable' : 'Enable',
            directory.isActive ? 'Disable directory access?' : 'Enable directory provisioning?',
            directory.isActive ? 'Deactivates managed accounts and revokes directory credentials and application sessions.' : 'Issue a fresh credential and resync explicitly. Revoked sessions stay closed.',
            '/admin/integrations/directories/' + directory.id, 'PATCH', { revision: directory.revision, name: directory.name, isActive: !directory.isActive, ssoLinking: directory.ssoLinking })),
        ]), 'No directory connections'), controls('directories', directories)), superadmin() ? button('Add directory', createDirectory, 'primary') : null),
      panel('Directory groups', 'Superadmins can map a managed group to the local administrator role.', node('div', {},
        table('Managed group mappings', ['Group', 'Group ID', 'Members', 'Mapped role', 'Actions'], groups.rows.map(group => [
          group.display_name, code(group.id), String(group.member_count), chip(group.mapped_role),
          superadmin() ? confirmChange(group.mapped_role === 'admin' ? 'Map to user' : 'Map to admin', 'Change directory role mapping?',
            'Membership in this group is controlled by the directory. Sessions of affected users will be revoked.',
            '/admin/integrations/groups/' + group.id + '/mapping', 'PATCH', { revision: group.revision, role: group.mapped_role === 'admin' ? 'user' : 'admin' }) : muted('Superadmin required'),
        ]), 'No provisioned groups'), controls('directory-groups', groups))));
  }

  async function credentials(directory, page = 1) {
    const content = node('div', { class: 'stack' }, stateCard('Loading credentials', 'Fetching directory credential metadata.', null, 'loading'));
    showDialog({ title: 'Directory credentials', content: [content] });
    const path = '/admin/integrations/directories/' + directory.id + '/credentials';
    try {
      const result = await api.request(path + '?limit=20&page=' + page);
      const expiry = input('expiry', { type: 'number', min: 1, max: 365, value: 30 });
      const issue = button('Issue credential', async () => {
        issue.disabled = true;
        try {
          const result = await mutate(path, 'POST', { expiresInDays: Number(expiry.value) });
          content.replaceChildren(node('p', {}, 'Copy the credential into the provider’s secret store. It is displayed once.'),
            field('Provisioning bearer credential', input('credential', { value: result.token, readonly: true, autocomplete: 'off', spellcheck: 'false' })),
            muted('Expires ' + moment(result.credential.expires_at)));
        } catch (error) { content.append(stateCard('Credential issue failed', error.message, null, 'error')); issue.disabled = false; }
      }, 'primary');
      content.replaceChildren(table('Credential metadata', ['ID', 'Expires', 'Last used', 'State', 'Actions'], result.credentials.map(row => [
        code(row.id), moment(row.expires_at), moment(row.last_used_at), chip(row.revoked_at ? 'Revoked' : Date.parse(row.expires_at) <= Date.now() ? 'Expired' : 'Issued'),
        superadmin() && !row.revoked_at ? confirmChange('Revoke', 'Revoke provisioning credential?', 'New provisioning requests using this credential will be denied.',
          '/admin/integrations/credentials/' + row.id, 'DELETE') : '—',
      ]), 'No issued credentials'), actions(page > 1 && button('Previous credentials', () => credentials(directory, page - 1)),
        result.credentials.length === 20 && button('More credentials', () => credentials(directory, page + 1))),
      ...(superadmin() && directory.isActive ? [field('Credential validity in days', expiry), issue] : []));
    } catch (error) { content.replaceChildren(stateCard('Credentials unavailable', error.message, null, 'error')); }
  }

  async function governance() {
    const [reviews, changes, compliance] = await Promise.all([
      list('access-reviews', '/admin/governance/reviews', 'reviews'), list('governance-changes', '/admin/governance/changes', 'changes'),
      list('device-compliance', '/admin/governance/device-compliance', 'devices'),
    ]);
    const createReview = () => showDialog({ title: 'Start access review', submit: 'Start review',
      content: [field('Review name', input('name', { required: true, maxlength: 160 })), field('Due date', input('dueAt', { type: 'date', required: true })),
        field('Optional user IDs, one per line', node('textarea', { name: 'userIds', rows: 3, maxlength: 3800 })),
        muted('Leave IDs empty to review all active users, up to 500.')],
      async run(form) {
        const userIds = form.get('userIds').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        await mutate('/admin/governance/reviews', 'POST', { name: form.get('name').trim(), dueAt: new Date(form.get('dueAt') + 'T23:59:59Z').toISOString(),
          ...(userIds.length && { userIds }) }); refresh();
      },
    });
    return node('div', { class: 'stack' },
      panel('Access reviews', 'Review current entitlements with a different administrator for each administrator’s own access.', node('div', {},
        table('Access review campaigns', ['Review', 'Due', 'State', 'Pending', 'Actions'], reviews.rows.map(row => [row.name, moment(row.due_at), chip(row.status),
          String(row.pending_count) + ' of ' + row.item_count, actions(button('View items', () => reviewItems(row), 'subtle'),
            row.status === 'open' && row.pending_count === 0 && confirmChange('Close review', 'Close access review?', 'Decisions and evidence will remain available.',
              '/admin/governance/reviews/' + row.id + '/close', 'POST', { revision: row.revision }))]), 'No access reviews'), controls('access-reviews', reviews)),
      button('Start review', createReview, 'primary')),
      panel('Evidence export', 'Export scoped JSON evidence with a digest and an audit receipt.', node('div', { class: 'panel-body' },
        button('Prepare export', exportDialog, 'subtle'))),
      panel('Administrative changes', 'Recorded governance mutations and their actors.', node('div', {},
        table('Administrative change history', ['Action', 'Target', 'Actor', 'When'], changes.rows.map(row => [row.action, code(row.target), code(row.actor_id || row.provisioning_credential_id), moment(row.created_at)])),
        controls('governance-changes', changes))),
      panel('Device posture', compliance.extra.provenance, node('div', {},
        table('Device compliance status', ['Device', 'Platform', 'Status', 'Valid until'], compliance.rows.map(row => [row.name, row.platform, chip(row.compliance), moment(row.posture_valid_until)])),
        controls('device-compliance', compliance))));
  }

  async function reviewItems(review, page = 1) {
    const content = node('div', { class: 'stack' }, stateCard('Loading review', 'Fetching access snapshots.', null, 'loading'));
    showDialog({ title: review.name, content: [content] });
    const path = '/admin/governance/reviews/' + review.id + '/items';
    try {
      const result = await api.request(path + '?limit=15&page=' + page);
      content.replaceChildren(table('Review items', ['User ID', 'Entitlements', 'Decision', 'Actions'], result.items.map(item => [code(item.user_id),
        node('details', {}, node('summary', {}, item.snapshot.role), definition([['Active', item.snapshot.active ? 'Yes' : 'No'],
          ['Locked', item.snapshot.locked ? 'Yes' : 'No'], ['Groups', item.snapshot.groups.map(g => code(g.id))],
          ['URL policies', item.snapshot.policies.map(p => code(p.id + ' v' + p.revision))]])), chip(item.decision),
        review.status === 'open' && item.user_id !== getAccount()?.id ? actions(
          confirmChange('Retain access', 'Retain this access?', 'Confirms the recorded entitlements for this subject.', path + '/' + item.id, 'PATCH', { revision: item.revision, decision: 'retain', reason: 'access_required' }),
          confirmChange('Revoke access', 'Revoke this account’s access?', 'Disables and locks the account and revokes all its application sessions.', path + '/' + item.id, 'PATCH', { revision: item.revision, decision: 'revoke', reason: 'no_longer_needed' }),
          confirmChange('Refresh snapshot', 'Refresh the access snapshot?', 'Resets the item to pending for another decision. Prior decisions are preserved.', path + '/' + item.id + '/refresh', 'POST', { revision: item.revision })) : '—',
      ]), 'No review items'), actions(page > 1 && button('Previous items', () => reviewItems(review, page - 1)),
        result.items.length === 15 && button('More items', () => reviewItems(review, page + 1))));
    } catch (error) { content.replaceChildren(stateCard('Review unavailable', error.message, null, 'error')); }
  }

  function exportDialog() {
    const dataset = select('dataset', [['audit', 'Security audit'], ['changes', 'Administrative changes'], ['reviews', 'Review decisions'],
      ['policy_versions', 'Policy versions'], ['users', 'User inventory'], ['devices', 'Device inventory']], 'audit');
    const content = node('div', { class: 'stack' });
    let cursor;
    let lastDataset;
    const download = button('Download JSON page', async () => {
      download.disabled = true;
      try {
        if (lastDataset !== dataset.value) cursor = undefined;
        const result = await mutate('/admin/governance/exports', 'POST', { dataset: dataset.value, limit: 500, ...(cursor && { cursor }) });
        cursor = result.nextCursor; lastDataset = dataset.value;
        const blob = new Blob([JSON.stringify({ manifest: result.manifest, rows: result.rows }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = node('a', { href: url, download: 'remoteshield-' + result.manifest.exportId + '.json' });
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        content.replaceChildren(node('p', { role: 'status' }, 'Exported ' + result.manifest.rowCount + ' rows.' + (cursor ? ' Select Download JSON page again for more.' : ' End of export.')));
      } catch (error) { content.replaceChildren(stateCard('Export failed', error.message, null, 'error')); }
      finally { download.disabled = false; }
    }, 'primary');
    showDialog({ title: 'Export confidential evidence', content: [field('Evidence dataset', dataset),
      muted('Event exports cover the last 30 days. Each file has an audited manifest. Store downloads in your approved evidence location.'), download, content] });
  }
  return { integrations, governance };
}

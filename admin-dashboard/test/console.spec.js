import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startFixture } from './fixture.cjs';
import { createHash } from 'node:crypto';

let fixture;
test.beforeAll(async () => { fixture = await startFixture(); });
test.afterAll(async () => { if (fixture) await fixture.close(); });

async function login(page, username = 'operator') {
  await page.goto(fixture.origin + '/admin/');
  if (username === 'operator') expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('loads live overview, chart and API error states on desktop and mobile', async ({ page }, info) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Organization overview', exact: true })).toBeVisible();
  await expect(page.getByText('Console verification lab').first()).toBeVisible();
  await page.getByText('View chart data').click();
  await expect(page.getByRole('table', { name: 'Seven-day security activity in UTC' })).toBeVisible();
  await page.getByText('View chart data').click();
  await expect(page.getByText('Live updates connected')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('console-overview.png'), fullPage: true });
  await page.route('**/api/v1/admin/stats', route => route.fulfill({
    status: 503, json: { error: 'Temporary fixture outage', requestId: 'test-reference' },
  }));
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('heading', { name: 'Unable to load this view' })).toBeVisible();
  await expect(page.getByText(/test-reference/)).toBeVisible();
  await page.unroute('**/api/v1/admin/stats');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Security activity' })).toBeVisible();
  await page.route('**/api/v1/admin/audit-log?*', route => route.fulfill({ status: 403, json: { error: 'Fixture permission denial' } }));
  await page.getByRole('link', { name: 'Audit log', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
  await page.unroute('**/api/v1/admin/audit-log?*');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'VPN health' }).click();
  await expect(page.getByText('Gate disabled')).toBeVisible();
  await expect(page.getByText('Gateway feed is not configured')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: info.outputPath('console-mobile.png'), fullPage: true });
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});

test('creates an assigned URL policy and reads persisted history', async ({ page }, info) => {
  await login(page);
  await page.getByRole('link', { name: 'URL policies' }).click();
  await expect(page.getByText('No records found.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Create policy' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Policy name').fill('Browser review policy');
  await dialog.getByLabel('Deny patterns, one per line').fill('review.console.test');
  await dialog.getByLabel('Assignment', { exact: true }).selectOption('users');
  await dialog.getByLabel('memberone').check();
  await dialog.getByRole('button', { name: 'Create policy' }).click();
  await expect(page.getByText('1 assigned user', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog.getByLabel('Policy name').fill('Revised browser policy');
  await dialog.getByRole('button', { name: 'Save revision' }).click();
  await expect(page.getByText('Revised browser policy')).toBeVisible();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(dialog.getByText('Revision 2 · Revised browser policy')).toBeVisible();
  await expect(dialog.getByText('Revision 1 · Browser review policy')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.screenshot({ path: info.outputPath('policy-management.png'), fullPage: true });
});

test('keeps device labels inert and audits revocation from the console', async ({ page }, info) => {
  await login(page);
  await page.getByRole('link', { name: 'Devices' }).click();
  await expect(page.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible();
  await expect(page.locator('#view img')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('device-management.png'), fullPage: true });
  await page.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByRole('table', { name: 'Device inventory' }).getByText('Revoked', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByText('device.trust_revoked', { exact: true })).toBeVisible();
});

test('ordinary accounts cannot open the console', async ({ page }) => {
  await login(page, 'memberone');
  await expect(page.getByRole('alert')).toContainText('Administrator access is required.');
  await expect(page.locator('#main')).toBeHidden();
});

test('creates a user and applies a role change through the console', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Users & roles' }).click();
  await page.getByRole('button', { name: 'Create user' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Username', { exact: true }).fill('operatorhelper');
  await dialog.getByLabel('Email', { exact: true }).fill('operator-helper@console.example.com');
  await dialog.getByLabel('Initial password').fill(fixture.password);
  await dialog.getByRole('button', { name: 'Create user' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const row = page.getByRole('row').filter({ hasText: 'operatorhelper' });
  await row.getByRole('button', { name: 'Change role' }).click();
  await dialog.getByLabel('New role').selectOption('admin');
  await dialog.getByRole('button', { name: 'Change role' }).click();
  await expect(row.getByText('admin', { exact: true })).toBeVisible();
});

test('all navigation views load and session termination takes effect', async ({ page }) => {
  await login(page);
  for (const [link, heading] of [['Security events', 'Reported security events'], ['Risk & alerts', 'Security incidents'],
    ['Account settings', 'Administrator profile'], ['Sessions', 'Active sessions']]) {
    await page.getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unable to load this view' })).toHaveCount(0);
  }
  const current = page.getByRole('row').filter({ hasText: 'operator@console.test' }).first();
  await current.getByRole('button', { name: 'Terminate', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Terminate', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Administrator sign in' })).toBeVisible();
});

test('notifies administrators and reviews real detection evidence with revision protection', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Live updates connected')).toBeVisible();
  await fixture.detectionFixture();
  await expect(page.locator('#notification')).toContainText('vpn_client_bypass');
  await page.getByRole('link', { name: 'Risk & alerts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Security incidents', level: 2 })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const incident = page.getByRole('row').filter({ hasText: 'vpn_client_bypass' });
  await incident.getByRole('button', { name: 'Review', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/client_report/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await dialog.getByLabel('Review status', { exact: true }).selectOption('resolved');
  await dialog.getByLabel('Disposition', { exact: true }).selectOption('benign');
  await dialog.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(dialog.getByLabel('Review status', { exact: true })).toHaveValue('resolved');
  await expect(dialog.getByRole('table', { name: 'Incident review history' }).getByText('benign', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Incident status', { exact: true }).selectOption('resolved');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'vpn_client_bypass' })).toBeVisible();
});

test('issues a scoped directory credential and assigns a real directory group policy', async ({ page, request }) => {
  await login(page);
  await page.getByRole('link', { name: 'Integrations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Directory provisioning' })).toBeVisible();
  await page.getByRole('button', { name: 'Add directory' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Directory name').fill('Browser directory fixture');
  await dialog.getByRole('button', { name: 'Add directory' }).click();
  const directory = page.getByRole('row').filter({ hasText: 'Browser directory fixture' });
  await directory.getByRole('button', { name: 'Credentials' }).click();
  await dialog.getByRole('button', { name: 'Issue credential' }).click();
  const credential = dialog.getByLabel('Provisioning bearer credential');
  await expect(credential).toBeVisible();
  const token = await credential.inputValue();
  const organization = token.split('.')[1];
  const group = await request.post(fixture.origin + '/scim/v2/' + organization + '/Groups', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/scim+json' },
    data: { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'Fixture managed group', externalId: 'browser-fixture-group' },
  });
  expect(group.status()).toBe(201);
  const { id } = await group.json();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(credential).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Fixture managed group', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('link', { name: 'URL policies', exact: true }).click();
  await page.getByRole('button', { name: 'Create policy' }).click();
  await dialog.getByLabel('Policy name').fill('Directory browser policy');
  await dialog.getByLabel('Assignment', { exact: true }).selectOption('groups');
  await dialog.getByLabel('Group IDs, one per line').fill(id);
  await dialog.getByRole('button', { name: 'Create policy' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Directory browser policy' })).toContainText('1 assigned group');
});

test('starts a review and downloads a verifiable governance export', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Governance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Device posture' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Start review' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Review name').fill('Browser access review');
  await dialog.getByLabel('Due date').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  await dialog.getByRole('button', { name: 'Start review' }).click();
  await page.getByRole('row').filter({ hasText: 'Browser access review' }).getByRole('button', { name: 'View items' }).click();
  await expect(dialog.getByRole('table', { name: 'Review items' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Prepare export' }).click();
  const pendingDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download JSON page' }).click();
  const download = await pendingDownload;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const { manifest, rows } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(manifest.dataset).toBe('audit');
  expect(rows.some(row => row.action === 'review.create')).toBe(true);
  const canonical = JSON.stringify(rows.map(row => Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]]))));
  expect(manifest.sha256).toBe(createHash('sha256').update(canonical).digest('hex'));
});

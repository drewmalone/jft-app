import { expect, test } from '@playwright/test';

test('stale session recovery keeps the draft, blocks saving until ready and deduplicates reset requests', async ({
  page,
  context,
  baseURL
}) => {
  await context.addCookies([
    {
      name: 'doorknob-session',
      value: 'fictional-stale-cookie',
      url: baseURL!,
      httpOnly: true
    }
  ]);
  await page.goto('/');
  const main = page.getByRole('main');
  await expect(main.getByRole('alert')).toContainText('invalid or expired');
  const draft = 'A fictional draft preserved during session recovery.';
  await page.getByRole('textbox').fill(draft);
  const save = page.getByRole('button', { name: 'Save privately' });
  await expect(save).toBeDisabled();
  await expect(
    page.getByRole('region', { name: 'Session recovery' })
  ).toContainText('will not restore access to previous shares');
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  let resets = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/session/reset', async (route) => {
    resets++;
    await pending;
    await route.continue();
  });
  await page
    .getByRole('button', { name: 'Start a new session' })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect.poll(() => resets).toBe(1);
  await expect(save).toBeDisabled();
  await expect(page.getByRole('textbox')).toHaveValue(draft);
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText('Loading your shares…');
  release();
  await expect(page.getByText('A place for your words.')).toBeVisible();
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Today’s reflection', exact: true })
    .click();
  await expect(page.getByRole('textbox')).toHaveValue(draft);
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    page.getByRole('heading', { name: 'Your share has been saved.' })
  ).toBeVisible();
  expect(resets).toBe(1);
});

test('failed recovery retains the draft and supports another explicit attempt', async ({
  page,
  context,
  baseURL
}) => {
  await context.addCookies([
    {
      name: 'doorknob-session',
      value: 'fictional-stale-cookie',
      url: baseURL!,
      httpOnly: true
    }
  ]);
  await page.goto('/');
  await page
    .getByRole('textbox')
    .fill('A fictional draft during a network failure.');
  await page.route('**/api/session/reset', (route) => route.abort());
  await page.getByRole('button', { name: 'Start a new session' }).click();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save privately' })
  ).toBeDisabled();
  await expect(page.getByRole('textbox')).toHaveValue(
    'A fictional draft during a network failure.'
  );
  await page.unroute('**/api/session/reset');
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('button', { name: 'Start a new session' }).click();
  await expect(
    page.getByRole('button', { name: 'Save privately' })
  ).toBeEnabled();
  await expect(page.getByRole('textbox')).toHaveValue(
    'A fictional draft during a network failure.'
  );
});

test('session rejection after a successful bootstrap disables saving and offers recovery in history', async ({
  page,
  context,
  baseURL
}) => {
  await page.goto('/');
  await page
    .getByRole('textbox')
    .fill('A fictional draft before key rotation.');
  await expect(
    page.getByRole('button', { name: 'Save privately' })
  ).toBeEnabled();
  await context.addCookies([
    {
      name: 'doorknob-session',
      value: 'fictional-replaced-key-cookie',
      url: baseURL!,
      httpOnly: true
    }
  ]);
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Start a new session' })
  ).toBeVisible();
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Today’s reflection', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Save privately' })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Start a new session' }).click();
  await expect(
    page.getByRole('button', { name: 'Save privately' })
  ).toBeEnabled();
  await expect(page.getByRole('textbox')).toHaveValue(
    'A fictional draft before key rotation.'
  );
});

import { expect, test } from '@playwright/test';

// Each test gets an isolated browser context and uses invented reflection text.
test('saves, persists, and opens shares in newest-first order', async ({
  page
}) => {
  await page.goto('/');
  const save = page.getByRole('button', { name: 'Save privately' });
  await expect(save).toBeDisabled();
  await page.getByRole('textbox').fill(' \n ');
  await expect(save).toBeDisabled();
  await page
    .getByRole('textbox')
    .fill('A fictional first thought.\nOne small step.');
  await save.click();
  await expect(
    page.getByRole('heading', { name: 'Your share has been saved.' })
  ).toBeFocused();
  await expect(page.locator('article')).toContainText('One small step.');
  await page.reload();
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await page
    .getByRole('listitem')
    .filter({ hasText: 'A fictional first thought.' })
    .getByRole('button')
    .click();
  await expect(page.locator('article')).toContainText(
    'A fictional first thought.'
  );
  await page
    .getByRole('button', { name: "Today's reflection", exact: true })
    .click();
  await page.getByRole('textbox').fill('A fictional second thought.');
  await save.click();
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await expect(page.getByRole('listitem').first()).toContainText(
    'A fictional second thought.'
  );
  await expect(page.getByRole('listitem')).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});

test('preserves a failed draft and saves it exactly once on retry', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('textbox').fill('A fictional draft to keep.');
  await page.route('**/api/shares', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Please try again.' }
        })
      });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Save privately' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'could not be saved'
  );
  await expect(page.getByRole('textbox')).toHaveValue(
    'A fictional draft to keep.'
  );
  await expect(page.getByRole('textbox')).toHaveAccessibleDescription(
    /could not be saved/
  );
  await expect(page.locator('form').getByRole('alert')).toContainText(
    'could not be saved'
  );
  await expect(
    page.getByRole('heading', { name: 'Write your share' })
  ).toBeVisible();

  await page.unroute('**/api/shares');
  await page.getByRole('button', { name: 'Save privately' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your share has been saved.' })
  ).toBeFocused();
  await expect(page.locator('article')).toContainText(
    'A fictional draft to keep.'
  );
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Today’s reflection', exact: true })
    .click();
  await expect(page.getByRole('textbox')).toHaveValue('');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('shows the empty history and retains a draft between views', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('textbox').fill('An unfinished fictional draft.');
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await expect(page.getByText('A place for your words.')).toBeVisible();
  await page.getByRole('button', { name: 'Write your first share' }).click();
  await expect(page.getByRole('textbox')).toHaveValue(
    'An unfinished fictional draft.'
  );
});

test('shows loading history, then the empty state', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/shares', async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto('/');
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText('Loading your shares…');
  await expect(page.getByText('A place for your words.')).toHaveCount(0);
  release();
  await expect(page.getByText('A place for your words.')).toBeVisible();
});

test('shows history API errors and supports retry', async ({ page }) => {
  await page.route('**/api/shares', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Please try again.' }
      })
    })
  );
  await page.goto('/');
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'could not be read'
  );
  await expect(page.getByText('A place for your words.')).toHaveCount(0);
  await page.unroute('**/api/shares');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('A place for your words.')).toBeVisible();
});

test('prevents duplicate submissions and waits for server confirmation', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('textbox').fill('A fictional pending thought.');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  await page.route('**/api/shares', async (route) => {
    if (route.request().method() === 'POST') {
      writes++;
      await pending;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Save privately' }).click();
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await expect(page.getByRole('textbox')).toHaveValue(
    'A fictional pending thought.'
  );
  await page.locator('form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(
    page.getByRole('heading', { name: 'Your share has been saved.' })
  ).toHaveCount(0);
  release();
  await expect(
    page.getByRole('heading', { name: 'Your share has been saved.' })
  ).toBeVisible();
  expect(writes).toBe(1);
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
});

test('fetches individual shares and reports detail failures', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('textbox').fill('A fictional detail thought.');
  await page.getByRole('button', { name: 'Save privately' }).click();
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await page.route('**/api/shares/*', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'SHARE_NOT_FOUND', message: 'Share not found.' }
      })
    })
  );
  await page.getByRole('listitem').getByRole('button').click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'could not be opened'
  );
  await page.unroute('**/api/shares/*');
  const fetched = page.waitForResponse(
    (response) =>
      /\/api\/shares\//.test(response.url()) && response.status() === 200
  );
  await page.getByRole('listitem').getByRole('button').click();
  await fetched;
  await expect(page.locator('article')).toContainText(
    'A fictional detail thought.'
  );
});

test('real HTTP requests retain shares and isolate browser sessions', async ({
  page,
  browser,
  baseURL
}) => {
  await page.goto('/');
  await page.getByRole('textbox').fill('A fictional isolated thought.');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/shares')
  );
  await page.getByRole('button', { name: 'Save privately' }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const share = await response.json();
  expect(share).not.toHaveProperty('ownerId');
  expect(
    await (
      await page.context().request.get(`${baseURL}/api/shares/${share.id}`)
    ).json()
  ).toEqual(share);
  const second = await browser.newContext();
  try {
    expect(
      await (await second.request.get(`${baseURL}/api/shares`)).json()
    ).toEqual([]);
    expect(
      (await second.request.get(`${baseURL}/api/shares/${share.id}`)).status()
    ).toBe(404);
    await second.clearCookies();
    await second.addCookies([
      { name: 'doorknob-session', value: 'forged', url: baseURL! }
    ]);
    expect((await second.request.get(`${baseURL}/api/shares`)).status()).toBe(
      401
    );
    expect(
      (
        await second.request.post(`${baseURL}/api/shares`, {
          data: { text: 'Fictional forged thought.' }
        })
      ).status()
    ).toBe(401);
  } finally {
    await second.close();
  }
  await page.context().clearCookies();
  expect(
    await (await page.context().request.get(`${baseURL}/api/shares`)).json()
  ).toEqual([]);
  expect(
    (
      await page.context().request.get(`${baseURL}/api/shares/${share.id}`)
    ).status()
  ).toBe(404);
});

import { expect, test } from './fixtures/test';
import { mockSpeech, emit } from './fixtures/openai-browser';

const original = 'Um, I called someone today. Uh, I felt calmer.';
const cleaned = 'I called someone today.\n\nI felt calmer.';

test('pausing preserves original words; Save prepares and displays only the server-confirmed text', async ({
  page,
  browser,
  baseURL,
  watchPage
}) => {
  await mockSpeech(page);
  let cleanupRequests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/shares/cleanup')) cleanupRequests++;
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/shares', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({ text: original, tidy: true });
    await pending;
    const response = await route.fetch({
      postData: JSON.stringify({ ...input, text: cleaned, tidy: false })
    });
    await route.fulfill({ response });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  await emit(page, 'speechResult', [[original, true]]);
  await emit(page, 'speechEnd');
  await expect(page.getByRole('textbox')).toHaveValue(original);
  expect(cleanupRequests).toBe(0);
  await page.locator('button.primary[type="submit"]').click();
  await expect(
    page.getByRole('heading', { name: 'Preparing your share…' })
  ).toBeFocused();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Your share is saved.' })
  ).toHaveCount(0);
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/shares')
  );
  release();
  const share = await (await saved).json();
  await expect(
    page.getByRole('heading', { name: 'Your share is saved.' })
  ).toBeFocused();
  await expect(page.locator('.thoughts-text')).toContainText('I felt calmer.');
  expect(share.text).toBe(cleaned);
  expect(cleanupRequests).toBe(0);
  const recipient = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const reader = await recipient.newPage();
    watchPage(reader);
    await reader.goto(new URL(share.shareUrl, baseURL).href);
    await expect(reader.getByLabel('Shared thoughts')).toContainText(
      'I felt calmer.'
    );
  } finally {
    await recipient.close();
  }
});

test('cleanup failure restores the draft and allows saving original words explicitly', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('textbox').fill(original);
  let saves = 0;
  await page.route('**/api/shares', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    saves++;
    if (saves === 1)
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'CLEANUP_UNAVAILABLE',
            message:
              'Your text could not be tidied. Your original words are still here.'
          }
        }
      });
    expect(route.request().postDataJSON().tidy).toBeUndefined();
    await route.continue();
  });
  await page.locator('button.primary[type="submit"]').click();
  await expect(page.locator('[data-save-error]')).toBeFocused();
  await expect(page.getByRole('textbox')).toHaveValue(original);
  await expect(
    page.getByRole('heading', { name: 'Preparing your share…' })
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Save original words', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your share is saved.' })
  ).toBeVisible();
  await expect(page.locator('.thoughts-text')).toContainText(original);
  expect(saves).toBe(2);
});

test('a failed save retains manual edits and retries explicitly without duplicating requests', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('textbox').fill(original);
  let saves = 0;
  await page.route('**/api/shares', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    saves++;
    if (saves === 1)
      return route.fulfill({
        status: 503,
        json: {
          error: { code: 'INTERNAL_ERROR', message: 'Please try again.' }
        }
      });
    await route.continue();
  });
  await page.locator('button.primary[type="submit"]').click();
  await expect(page.getByRole('textbox')).toHaveValue(original);
  await page.getByRole('textbox').fill('Manually corrected words.');
  await page.locator('button.primary[type="submit"]').click();
  await expect(
    page.getByRole('heading', { name: 'Your share is saved.' })
  ).toBeVisible();
  await expect(page.locator('.thoughts-text')).toContainText(
    'Manually corrected words.'
  );
  expect(saves).toBe(2);
});

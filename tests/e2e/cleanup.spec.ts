import { expect, test, type Page } from '@playwright/test';
import { mockSpeech, emit } from './fixtures/openai-browser';

const original =
  'Um, I called someone today. Uh, I felt calmer. I will try again tomorrow.';
const cleaned =
  'I called someone today. I felt calmer.\n\nI will try again tomorrow.';
async function recordAndStop(page: Page) {
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  await emit(page, 'speechResult', [[original, true]]);
  await page.getByRole('button', { name: 'Stop listening' }).click();
  await emit(page, 'speechEnd');
}

test('Stop automatically tidies final text, waits before saving, and preserves paragraph sharing and history', async ({
  page,
  browser,
  baseURL
}) => {
  await mockSpeech(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cleanupRequests = 0,
    saves = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/shares'))
      saves++;
  });
  await page.route('**/api/shares/cleanup', async (route) => {
    cleanupRequests++;
    expect(route.request().postDataJSON()).toEqual({ text: original });
    await pending;
    await route.fulfill({ json: { text: cleaned } });
  });
  await page.goto('/');
  await recordAndStop(page);
  await expect(page.getByRole('status')).toHaveText(
    'Tidying your words… You can keep editing.'
  );
  await expect(
    page.getByRole('button', { name: 'Save privately' })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Record your share' })
  ).toBeDisabled();
  await expect(page.getByRole('textbox')).toHaveValue(original);
  expect(saves).toBe(0);
  release();
  await expect(page.getByRole('textbox')).toHaveValue(cleaned);
  await expect(
    page.getByRole('button', { name: 'Undo cleanup' })
  ).toBeVisible();
  expect(cleanupRequests).toBe(1);
  expect(saves).toBe(0);
  await page.getByRole('textbox').fill(cleaned + ' Edited.');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/shares')
  );
  await page.getByRole('button', { name: 'Save privately' }).click();
  const share = await (await saved).json();
  expect(share.text).toBe(cleaned + ' Edited.');
  const paragraphs = page.locator('.share-card .space-y-4 > p');
  await expect(paragraphs).toHaveCount(2);
  await expect(paragraphs.nth(1)).toHaveText(
    'I will try again tomorrow. Edited.'
  );
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await expect(page.getByRole('listitem')).toContainText(
    'I called someone today.'
  );
  const reader = await browser.newContext();
  try {
    const other = await reader.newPage();
    await other.goto(new URL(share.shareUrl, baseURL).href);
    await expect(
      other.getByRole('region', { name: 'Shared thoughts' }).locator('p')
    ).toHaveCount(2);
  } finally {
    await reader.close();
  }
});

test('cleanup can be undone after in-app navigation and never persists a draft across refresh', async ({
  page
}) => {
  await mockSpeech(page);
  await page.route('**/api/shares/cleanup', (route) =>
    route.fulfill({ json: { text: cleaned } })
  );
  await page.goto('/');
  await recordAndStop(page);
  await expect(page.getByRole('textbox')).toHaveValue(cleaned);
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Past shares' })
    .click();
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Today’s reflection' })
    .click();
  await page.getByRole('button', { name: 'Undo cleanup' }).click();
  await expect(page.getByRole('textbox')).toHaveValue(original);
  await page.reload();
  await expect(page.getByRole('textbox')).toHaveValue('');
});

test('cleanup failure keeps the original editable and saveable, with a retry', async ({
  page
}) => {
  await mockSpeech(page);
  let calls = 0;
  await page.route('**/api/shares/cleanup', (route) =>
    ++calls === 1
      ? route.fulfill({
          status: 503,
          json: {
            error: { code: 'CLEANUP_UNAVAILABLE', message: 'Unavailable.' }
          }
        })
      : route.fulfill({ json: { text: cleaned } })
  );
  await page.goto('/');
  await recordAndStop(page);
  await expect(
    page.getByText(
      'Your text could not be tidied. Your original words are still here.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue(original);
  await expect(
    page.getByRole('button', { name: 'Save privately' })
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Retry cleanup' }).click();
  await expect(page.getByRole('textbox')).toHaveValue(cleaned);
});

for (const action of ['edit', 'navigate'] as const) {
  test(`a late cleanup cannot overwrite ${action === 'edit' ? 'manual edits' : 'a navigated draft'}`, async ({
    page
  }) => {
    await mockSpeech(page);
    let release!: () => void;
    let completed = false;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/shares/cleanup', async (route) => {
      await pending;
      try {
        await route.fulfill({ json: { text: cleaned } });
      } catch {
        /* Request cancellation is the behavior under test. */
      }
      completed = true;
    });
    await page.goto('/');
    await recordAndStop(page);
    await expect(
      page.getByText('Tidying your words… You can keep editing.', {
        exact: true
      })
    ).toBeVisible();
    if (action === 'edit')
      await page.getByRole('textbox').fill('My intentional edit.');
    else {
      await page
        .getByRole('banner')
        .getByRole('button', { name: 'Past shares' })
        .click();
      await page
        .getByRole('banner')
        .getByRole('button', { name: 'Today’s reflection' })
        .click();
    }
    release();
    await expect.poll(() => completed).toBe(true);
    await expect(page.getByRole('textbox')).toHaveValue(
      action === 'edit' ? 'My intentional edit.' : original
    );
    await expect(
      page.getByRole('button', { name: 'Undo cleanup' })
    ).toHaveCount(0);
  });
}

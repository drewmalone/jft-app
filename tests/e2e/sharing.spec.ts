import { expect, test, type Page } from '@playwright/test';
import { reflection } from '../../src/shares/reflection-fixture';

const fictionalText =
  'A fictional thought for a fellow alcoholic.\nOne day at a time.';
async function save(page: Page) {
  await page.goto('/');
  await page.getByRole('textbox').fill(fictionalText);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/shares') && r.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Save privately' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your share has been saved.' })
  ).toBeVisible();
  return (await response).json();
}

test('share icon uses the saved URL directly for native sharing and session-free reading', async ({
  page,
  browser,
  baseURL
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        Object.assign(window, { sharedUrl: data.url });
      }
    })
  );
  let linkRequests = 0;
  page.on('request', (request) => {
    if (/\/api\/shares\/[^/]+\/link$/.test(request.url())) linkRequests++;
  });
  const saved = await save(page);
  const link = new URL(saved.shareUrl, baseURL).href;
  const button = page.getByRole('button', { name: 'Share', exact: true });
  await expect(button.locator('circle')).toHaveCount(3);
  await button.click();
  expect(await page.evaluate(() => Reflect.get(window, 'sharedUrl'))).toBe(
    link
  );
  expect(linkRequests).toBe(0);
  await expect(page.getByLabel('Sharing link')).toHaveCount(0);
  await expect(
    page.getByText(/expires|anyone with this link|revoked/i)
  ).toHaveCount(0);
  const recipient = await browser.newContext();
  try {
    const reader = await recipient.newPage();
    const response = await reader.goto(link);
    expect(response!.status()).toBe(200);
    expect(response!.headers()['cache-control']).toContain('private');
    expect(response!.headers()['cache-control']).toContain('no-store');
    expect(response!.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(response!.headers()['referrer-policy']).toBe('no-referrer');
    expect(response!.headers()['set-cookie']).toBeUndefined();
    await expect(
      reader.getByRole('heading', { name: reflection.title })
    ).toBeVisible();
    await expect(
      reader.getByText(reflection.body, { exact: true })
    ).toBeVisible();
    await expect(reader.getByLabel('Shared thoughts')).toContainText(
      fictionalText
    );
    await expect(
      reader.getByText('April 23, 2025', { exact: false })
    ).toBeVisible();
    expect(await recipient.cookies()).toEqual([]);
    const signed = new URL(link);
    const publicPath = `/api/public/shares/${saved.id}${signed.search}`;
    const publicResponse = await recipient.request.get(publicPath);
    expect(await publicResponse.json()).toEqual({
      reflection,
      text: fictionalText
    });
    expect(publicResponse.headers()['set-cookie']).toBeUndefined();
    expect(await recipient.cookies()).toEqual([]);
    expect(
      (await recipient.request.get(`/api/shares/${saved.id}`)).status()
    ).toBe(404);
    expect(await (await recipient.request.get('/api/shares')).json()).toEqual(
      []
    );
    for (const suffix of [
      '',
      '?expires=1&sig=invalid',
      `${signed.search}&sig=duplicate`
    ]) {
      await reader.goto(`${signed.origin}${signed.pathname}${suffix}`);
      await expect(
        reader.getByRole('heading', { name: 'This share is unavailable' })
      ).toBeVisible();
      await expect(reader.getByLabel('Shared thoughts')).toHaveCount(0);
    }
    expect(
      (
        await recipient.request.get(
          `/api/public/shares/${saved.id}?expires=1&sig=invalid`
        )
      ).status()
    ).toBe(404);
  } finally {
    await recipient.close();
  }
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await page.getByRole('listitem').getByRole('button').click();
  await button.click();
  expect(await page.evaluate(() => Reflect.get(window, 'sharedUrl'))).toBe(
    link
  );
  expect(linkRequests).toBe(0);
});

test('unsupported native sharing copies directly, with manual copying only when needed', async ({
  page,
  baseURL
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          Object.assign(window, { copiedUrl: value });
        }
      }
    });
  });
  const saved = await save(page);
  const button = page.getByRole('button', { name: 'Share', exact: true });
  await button.click();
  await expect(page.getByRole('status')).toHaveText('Link copied.');
  expect(await page.evaluate(() => Reflect.get(window, 'copiedUrl'))).toBe(
    new URL(saved.shareUrl, baseURL).href
  );
  await expect(page.getByLabel('Sharing link')).toHaveCount(0);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Denied');
        }
      }
    })
  );
  await button.click();
  await expect(page.getByLabel('Sharing link')).toBeFocused();
  await expect(page.getByLabel('Sharing link')).toHaveValue(
    new URL(saved.shareUrl, baseURL).href
  );
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(button).toBeFocused();
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined
    })
  );
  await button.click();
  await expect(page.getByLabel('Sharing link')).toBeFocused();
});

test('native cancellation stays silent and native failures fall back to copying', async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new DOMException('Canceled', 'AbortError');
      }
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          Object.assign(window, { copied: true });
        }
      }
    });
  });
  await save(page);
  const button = page.getByRole('button', { name: 'Share', exact: true });
  await button.click();
  await expect(button).toBeEnabled();
  expect(
    await page.evaluate(() => Reflect.get(window, 'copied'))
  ).toBeUndefined();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByLabel('Sharing link')).toHaveCount(0);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new Error('Unavailable');
      }
    })
  );
  await button.click();
  await expect(page.getByRole('status')).toHaveText('Link copied.');
});

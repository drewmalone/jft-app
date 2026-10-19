import { expect, test, type Page } from '@playwright/test';
import { reflection } from '../../src/shares/reflection-fixture';

const fictionalText =
  'A fictional thought for a fellow alcoholic.\nOne day at a time.';
const action = 'Share with another alcoholic';
async function save(page: Page) {
  await page.goto('/');
  await page.getByRole('textbox').fill(fictionalText);
  await page.getByRole('button', { name: 'Save privately' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your share has been saved.' })
  ).toBeVisible();
}

test('intentionally shares saved and past reflections with a session-free recipient', async ({
  page,
  browser
}) => {
  let linkRequests = 0;
  page.on('request', (request) => {
    if (/\/api\/shares\/[^/]+\/link$/.test(request.url())) linkRequests++;
  });
  await save(page);
  expect(linkRequests).toBe(0);
  await page.getByRole('button', { name: action }).click();
  await expect(page.getByLabel('Sharing link')).toBeVisible();
  expect(linkRequests).toBe(1);
  const link = await page.getByLabel('Sharing link').inputValue();
  expect(link).not.toContain(encodeURIComponent(fictionalText));
  await expect(
    page.getByText(
      "Anyone with this link can read your share until it expires. They don't need a Doorknob account."
    )
  ).toBeVisible();
  const recipient = await browser.newContext();
  try {
    expect(await recipient.cookies()).toEqual([]);
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
    await expect(
      reader.getByRole('button', { name: 'Past shares' })
    ).toHaveCount(0);
    expect(await recipient.cookies()).toEqual([]);
    const signed = new URL(link);
    const id = signed.pathname.split('/').pop();
    const publicPath = `/api/public/shares/${id}${signed.search}`;
    const publicResponse = await recipient.request.get(publicPath);
    expect(publicResponse.status()).toBe(200);
    expect(await publicResponse.json()).toEqual({
      reflection,
      text: fictionalText
    });
    expect(publicResponse.headers()['set-cookie']).toBeUndefined();
    expect(await recipient.cookies()).toEqual([]);
    // Knowing the ID and capability does not authorize private history/detail/link generation.
    expect((await recipient.request.get(`/api/shares/${id}`)).status()).toBe(
      404
    );
    expect(await (await recipient.request.get('/api/shares')).json()).toEqual(
      []
    );
    expect(
      (await recipient.request.post(`/api/shares/${id}/link`)).status()
    ).toBe(404);
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
    const rejected = await recipient.request.get(
      `/api/public/shares/${id}?expires=1&sig=invalid`
    );
    expect(rejected.status()).toBe(404);
    expect(rejected.headers()['set-cookie']).toBeUndefined();
  } finally {
    await recipient.close();
  }
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await page.getByRole('listitem').getByRole('button').click();
  await expect(page.getByRole('button', { name: action })).toBeVisible();
  await page.getByRole('button', { name: action }).click();
  await expect(page.getByLabel('Sharing link')).toBeVisible();
  expect(linkRequests).toBe(2);
});

test('link generation errors can be retried without changing the private share', async ({
  page
}) => {
  await save(page);
  await page.route('**/api/shares/*/link', (route) => route.abort());
  await page.getByRole('button', { name: action }).click();
  await expect(
    page
      .getByRole('region', { name: 'Share this reflection' })
      .getByRole('alert')
  ).toContainText('could not be created');
  await expect(page.locator('article')).toContainText(fictionalText);
  await expect(page.getByLabel('Sharing link')).toHaveCount(0);
  await page.unroute('**/api/shares/*/link');
  await page.getByRole('button', { name: action }).click();
  await expect(page.getByLabel('Sharing link')).toBeVisible();
});

test('copy and native sharing use the generated URL without claiming delivery', async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          Object.assign(window, { copiedLink: text });
        }
      }
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        Object.assign(window, { sentLink: data.url });
      }
    });
  });
  await save(page);
  await page.getByRole('button', { name: action }).click();
  const link = page.getByLabel('Sharing link');
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Link copied.');
  expect(await page.evaluate(() => Reflect.get(window, 'copiedLink'))).toBe(
    url
  );
  await page.getByRole('button', { name: 'Send share', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'cannot confirm delivery'
  );
  expect(await page.evaluate(() => Reflect.get(window, 'sentLink'))).toBe(url);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new DOMException('Canceled', 'AbortError');
      }
    })
  );
  await page.getByRole('button', { name: 'Send share', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Sharing canceled');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new Error('Unavailable');
      }
    })
  );
  await page.getByRole('button', { name: 'Send share', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Share this reflection' })
      .getByRole('alert')
  ).toContainText('could not open');
});

test('clipboard and native sharing failures leave a selectable manual fallback', async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Denied');
        }
      }
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined
    });
  });
  await save(page);
  await page.getByRole('button', { name: action }).click();
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Share this reflection' })
      .getByRole('alert')
  ).toContainText('Select and copy');
  await expect(page.getByLabel('Sharing link')).toBeFocused();
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined
    })
  );
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Share this reflection' })
      .getByRole('alert')
  ).toContainText('Select and copy');
  await page.getByRole('button', { name: 'Send share', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'Device sharing is unavailable'
  );
  await expect(page.getByLabel('Sharing link')).toBeFocused();
});

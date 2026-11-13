import { test, expect } from './fixtures/test';
import { mockSpeech, emit } from './fixtures/openai-browser';
import { randomUUID } from 'node:crypto';
import { readingDate } from '../../src/readings/calendar';

test.use({ timezoneId: 'Asia/Tokyo' });

function fictionalReading(date: string) {
  return {
    id: `jft-${date}`,
    date,
    title: `Fictional daily reading ${date}`,
    body: 'Fictional morning paragraph.\n\nFictional closing paragraph.'
  };
}

test('browser supplies its timezone and saving keeps the displayed reading across midnight', async ({
  page,
  context
}) => {
  const now = Date.now() + 3 * 86400_000;
  const date = readingDate('Asia/Tokyo', now);
  const reading = fictionalReading(date);
  let servedDate = date;
  await page.clock.install({ time: new Date(now) });
  await page.route('**/api/readings/today?*', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('timeZone')).toBe(
      'Asia/Tokyo'
    );
    await route.fulfill({
      json: {
        date: servedDate,
        reading: fictionalReading(servedDate),
        sample: false
      }
    });
  });
  await page.goto('/');
  await expect(page.getByText(reading.title, { exact: true })).toBeVisible();
  const preference = (await context.cookies()).find(
    (cookie) => cookie.name === 'reading-time-zone'
  );
  expect(decodeURIComponent(preference!.value)).toBe('Asia/Tokyo');
  await page
    .getByRole('textbox')
    .fill('Fictional thoughts about the displayed reading.');
  await expect(page.locator('button.primary[type="submit"]')).toBeEnabled();
  servedDate = readingDate('Asia/Tokyo', now + 86400_000);
  await page.clock.setSystemTime(new Date(now + 86400_000));
  const refreshed = page.waitForResponse('**/api/readings/today?*');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refreshed;
  await expect(page.getByText(reading.title, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Past shares' }).click();
  await page.getByRole('button', { name: 'Today’s reflection' }).click();
  await expect(page.getByText(reading.title, { exact: true })).toBeVisible();
  await page.route('**/api/shares', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    expect(route.request().postDataJSON()).toEqual({
      text: 'Fictional thoughts about the displayed reading.',
      readingDate: date,
      readingId: reading.id
    });
    const id = randomUUID();
    await route.fulfill({
      status: 201,
      json: {
        id,
        shareUrl: `/s/${id}`,
        createdAt: new Date(now).toISOString(),
        kind: 'text',
        text: 'Fictional thoughts about the displayed reading.',
        reflection: reading
      }
    });
  });
  await page.locator('button.primary[type="submit"]').click();
  await expect(
    page.getByRole('heading', { name: 'Your share is saved.' })
  ).toBeVisible();
  await expect(page.locator('article')).toContainText(reading.title);
  await page
    .getByRole('button', { name: "Today's reflection", exact: true })
    .click();
  await expect(page.getByRole('textbox')).toHaveValue('');
  await expect(
    page.getByText(fictionalReading(servedDate).title, { exact: true })
  ).toBeVisible();
});

test('returning to the page after local midnight selects the new reading', async ({
  page
}) => {
  const now = Date.now() + 3 * 86400_000;
  let date = readingDate('Asia/Tokyo', now);
  await page.clock.install({ time: new Date(now) });
  await page.route('**/api/readings/today?*', (route) =>
    route.fulfill({
      json: { date, reading: fictionalReading(date), sample: false }
    })
  );
  await page.goto('/');
  await expect(
    page.getByText(fictionalReading(date).title, { exact: true })
  ).toBeVisible();
  date = readingDate('Asia/Tokyo', now + 86400_000);
  await page.clock.setSystemTime(new Date(now + 86400_000));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByText(fictionalReading(date).title, { exact: true })
  ).toBeVisible();
});

test('a missing reading preserves the draft, blocks saving, and allows retry', async ({
  page
}) => {
  const now = Date.now() + 3 * 86400_000;
  const date = readingDate('Asia/Tokyo', now);
  let published = false;
  await page.clock.install({ time: new Date(now) });
  await page.route('**/api/readings/today?*', (route) =>
    route.fulfill({
      json: {
        date,
        reading: published ? fictionalReading(date) : null,
        sample: false
      }
    })
  );
  await page.goto('/');
  await expect(
    page.getByText("Today's reading is not available yet.")
  ).toBeVisible();
  await page.getByRole('textbox').fill('Fictional draft to retain.');
  await expect(page.locator('button.primary[type="submit"]')).toBeDisabled();
  published = true;
  await page.getByRole('button', { name: 'Try reading again' }).click();
  await expect(
    page.getByText(fictionalReading(date).title, { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue(
    'Fictional draft to retain.'
  );
  await expect(page.locator('button.primary[type="submit"]')).toBeEnabled();
});

test('an editorial update refreshes the reading without losing the draft or resubmitting it', async ({
  page
}) => {
  const now = Date.now() + 3 * 86400_000;
  const date = readingDate('Asia/Tokyo', now);
  let revised = false;
  await page.clock.install({ time: new Date(now) });
  await page.route('**/api/readings/today?*', (route) =>
    route.fulfill({
      json: {
        date,
        reading: {
          ...fictionalReading(date),
          id: revised ? `revised-${date}` : `jft-${date}`,
          title: revised
            ? 'Fictional revised reading'
            : fictionalReading(date).title
        },
        sample: false
      }
    })
  );
  let saves = 0;
  await page.route('**/api/shares', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    saves++;
    revised = true;
    await route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'READING_CHANGED',
          message:
            'The reading was updated. Your words are still here. Review the updated reading before saving again.'
        }
      }
    });
  });
  await page.goto('/');
  await expect(
    page.getByText(fictionalReading(date).title, { exact: true })
  ).toBeVisible();
  await page
    .getByRole('textbox')
    .fill('Fictional draft to keep after an edit.');
  await page.locator('button.primary[type="submit"]').click();
  await page.getByRole('button', { name: 'Review current reading' }).click();
  await expect(
    page.getByText('Fictional revised reading', { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue(
    'Fictional draft to keep after an edit.'
  );
  await expect(page.locator('button.primary[type="submit"]')).toBeEnabled();
  expect(saves).toBe(1);
});

test('recording pins the reading before any final words and releases an empty stopped draft', async ({
  page
}) => {
  const now = Date.now() + 3 * 86400_000;
  let date = readingDate('Asia/Tokyo', now);
  const original = fictionalReading(date);
  await mockSpeech(page);
  await page.clock.install({ time: new Date(now) });
  await page.route('**/api/readings/today?*', (route) =>
    route.fulfill({
      json: { date, reading: fictionalReading(date), sample: false }
    })
  );
  await page.goto('/');
  await expect(page.getByText(original.title, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  date = readingDate('Asia/Tokyo', now + 86400_000);
  await page.clock.setSystemTime(new Date(now + 86400_000));
  const refreshed = page.waitForResponse('**/api/readings/today?*');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refreshed;
  await expect(page.getByRole('textbox')).toHaveValue('');
  await expect(page.getByText(original.title, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop listening' }).click();
  await emit(page, 'speechEnd');
  await expect(
    page.getByText(fictionalReading(date).title, { exact: true })
  ).toBeVisible();
});

for (const activeDraft of [false, true]) {
  test(`failed rollover ${activeDraft ? 'keeps an active draft pinned' : 'blocks a new draft from using yesterday'}`, async ({
    page
  }) => {
    const now = Date.now() + 3 * 86400_000;
    const date = readingDate('Asia/Tokyo', now);
    let failed = false;
    await page.clock.install({ time: new Date(now) });
    await page.route('**/api/readings/today?*', (route) =>
      route.fulfill(
        failed
          ? {
              status: 503,
              json: {
                error: {
                  code: 'READING_UNAVAILABLE',
                  message: 'Fictional unavailable reading.'
                }
              }
            }
          : { json: { date, reading: fictionalReading(date), sample: false } }
      )
    );
    await page.goto('/');
    await expect(
      page.getByText(fictionalReading(date).title, { exact: true })
    ).toBeVisible();
    if (activeDraft)
      await page.getByRole('textbox').fill('Fictional active draft.');
    failed = true;
    await page.clock.setSystemTime(new Date(now + 86400_000));
    const refreshed = page.waitForResponse('**/api/readings/today?*');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await refreshed;
    if (activeDraft) {
      await expect(
        page.getByText(fictionalReading(date).title, { exact: true })
      ).toBeVisible();
      await expect(page.locator('button.primary[type="submit"]')).toBeEnabled();
    } else {
      await expect(
        page.getByText("Today's reading is not available yet.")
      ).toBeVisible();
      await page.getByRole('textbox').fill('Fictional new draft.');
      await expect(
        page.locator('button.primary[type="submit"]')
      ).toBeDisabled();
      await expect(
        page.getByText(fictionalReading(date).title, { exact: true })
      ).toHaveCount(0);
    }
  });
}

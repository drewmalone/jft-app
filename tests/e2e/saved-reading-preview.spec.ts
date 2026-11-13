import { expect, test } from './fixtures/test';

for (const width of [320, 390]) {
  test(`saved thoughts appear above the action bar with a long original reading at ${width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 568 });
    const body =
      'A fictional original reading with extensive background context. '.repeat(
        60
      );
    const quote =
      'A fictional quotation that should stay inside the collapsed reading.';
    await page.route('**/api/shares', async (route) => {
      const response = await route.fetch();
      if (route.request().method() === 'POST') {
        const share = await response.json();
        await route.fulfill({
          response,
          json: { ...share, reflection: { ...share.reflection, body, quote } }
        });
      } else await route.fulfill({ response });
    });
    await page.goto('/');
    await page
      .getByRole('textbox')
      .fill('These are my thoughts, and they should be the focus.');
    await page.locator('button.primary[type="submit"]').click();
    await expect(
      page.getByRole('heading', { name: 'Your share is saved.' })
    ).toBeVisible();
    const thoughts = page.getByText(
      'These are my thoughts, and they should be the focus.',
      { exact: true }
    );
    await expect(thoughts).toBeInViewport();
    const actions = await page
      .getByRole('region', { name: 'Share actions' })
      .boundingBox();
    const words = await thoughts.boundingBox();
    expect(words!.y + words!.height).toBeLessThanOrEqual(actions!.y);
    const fullReading = page.getByText(body.trim(), { exact: true });
    await expect(fullReading).not.toBeVisible();
    await expect(page.getByText(quote, { exact: true })).not.toBeVisible();
    const toggle = page.locator('details summary');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(fullReading).toBeVisible();
    await expect(page.getByText(quote, { exact: true })).toBeVisible();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(fullReading).not.toBeVisible();
  });
}

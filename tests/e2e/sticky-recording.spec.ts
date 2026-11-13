import { expect, test } from './fixtures/test';
import { mockSpeech, emit } from './fixtures/openai-browser';

for (const target of ['dock', 'editor']) {
  test(`${target} Save flushes recording, waits for cleanup, and saves exactly once`, async ({
    page
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await mockSpeech(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/shares/cleanup', async (route) => {
      await pending;
      await route.fulfill({
        json: { text: 'Earlier words. Corrected final words.' }
      });
    });
    let saves = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/shares'))
        saves++;
    });
    await page.goto('/');
    const panel = page.locator('.recording-panel');
    const preview = page.getByRole('region', {
      name: 'Latest recognized words'
    });
    await expect(panel).toBeInViewport();
    expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(124);
    await expect(
      panel.getByRole('button', { name: 'Save', exact: true })
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Record your share' }).click();
    await emit(page, 'speechStart');
    await emit(page, 'speechResult', [
      ['Earlier words. '.repeat(30), true],
      ['Latest provisional words', false]
    ]);
    await expect(preview).toContainText('Latest provisional words');
    await expect
      .poll(() => preview.evaluate((el) => el.scrollTop > 0))
      .toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(panel).toBeInViewport();
    expect(
      await page.evaluate(() => Reflect.get(window, 'microphoneRequests'))
    ).toBe(1);
    const button = page.locator(
      target === 'dock' ? '.dock-save-button' : 'button.primary[type="submit"]'
    );
    await button.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await button.click();
    await expect(button).toBeDisabled();
    await emit(page, 'speechResult', [
      ['Earlier words. '.repeat(30), true],
      ['Corrected final words.', true]
    ]);
    await emit(page, 'speechEnd');
    await expect(page.getByRole('textbox')).toHaveValue(
      /Corrected final words\./
    );
    await expect(page.getByRole('status')).toHaveText('Tidying!');
    expect(saves).toBe(0);
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/api/shares')
    );
    release();
    expect((await (await saved).json()).text).toBe(
      'Earlier words. Corrected final words.'
    );
    await expect(
      page.getByRole('heading', { name: 'Your share is saved.' })
    ).toBeVisible();
    expect(saves).toBe(1);
  });
}

test('dock Save saves a paused draft', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await mockSpeech(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  await emit(page, 'speechResult', [['Paused final words.', true]]);
  await emit(page, 'speechEnd');
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/shares')
  );
  await page.locator('.dock-save-button').click();
  expect((await (await saved).json()).text).toBe('Paused final words.');
});

test('an interrupted save retains the draft without saving incomplete speech', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await mockSpeech(page);
  let saves = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/shares'))
      saves++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  await emit(page, 'speechResult', [['Retained final words.', true]]);
  await page.locator('.dock-save-button').click();
  await emit(page, 'speechError', 'network');
  await expect(
    page.getByText('Recording interrupted', { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue('Retained final words.');
  expect(saves).toBe(0);
});

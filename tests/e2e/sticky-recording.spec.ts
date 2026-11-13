import { expect, test } from './fixtures/test';
import { mockSpeech, emit } from './fixtures/openai-browser';

for (const width of [320, 375, 390]) {
  test(`compact dock at ${width}px reviews final words without saving or restarting capture`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width, height: 667 });
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
    await expect(panel).toHaveAttribute('data-visible', 'true');
    await expect(panel.getByRole('button')).toHaveCount(1);
    await expect(preview).toHaveText('Your words will appear here.');
    await expect(page.getByText('Tap to begin', { exact: true })).toBeVisible();
    const idleHeight = (await panel.boundingBox())!.height;
    expect(idleHeight).toBeGreaterThanOrEqual(110);
    expect(idleHeight).toBeLessThanOrEqual(140);
    if (width > 320)
      await page.screenshot({
        path: testInfo.outputPath(`dock-${width}-idle.png`)
      });
    await panel.getByRole('button', { name: 'Record your share' }).click();
    await emit(page, 'speechStart');
    await expect(page.getByText('Listening…', { exact: true })).toBeVisible();
    await emit(page, 'speechResult', [
      ['Earlier words. '.repeat(30), true],
      ['Latest provisional words', false]
    ]);
    await expect(preview).toContainText('Latest provisional words');
    await expect
      .poll(() => preview.evaluate((el) => el.scrollTop > 0))
      .toBe(true);
    const height = (await panel.boundingBox())!.height;
    expect(height).toBeLessThanOrEqual(140);
    const review = panel.getByRole('button', { name: 'Finish & review' });
    const previewBounds = (await preview.boundingBox())!;
    const reviewBounds = (await review.boundingBox())!;
    expect(reviewBounds.y).toBeGreaterThanOrEqual(
      previewBounds.y + previewBounds.height
    );
    expect(reviewBounds.x + reviewBounds.width).toBeCloseTo(
      previewBounds.x + previewBounds.width,
      0
    );
    expect(reviewBounds.height).toBeGreaterThanOrEqual(44);
    if (width > 320)
      await page.screenshot({
        path: testInfo.outputPath(`dock-${width}-recording.png`)
      });
    await emit(page, 'speechResult', [
      ['Earlier words. '.repeat(30), true],
      [' More provisional words', false]
    ]);
    expect((await panel.boundingBox())!.height).toBeCloseTo(height, 0);
    await review.click();
    await emit(page, 'speechResult', [
      ['Earlier words. '.repeat(30), true],
      ['Corrected final words.', true]
    ]);
    await emit(page, 'speechEnd');
    await expect(page.getByRole('textbox')).not.toBeFocused();
    await expect(page.getByRole('textbox')).toHaveValue(
      /Corrected final words\./
    );
    expect(saves).toBe(0);
    release();
    await expect(page.getByRole('textbox')).toBeFocused();
    await expect(page.getByRole('textbox')).toHaveValue(
      'Earlier words. Corrected final words.'
    );
    await expect(panel).toHaveAttribute('data-visible', 'false');
    expect(
      await page.evaluate(() => Reflect.get(window, 'microphoneRequests'))
    ).toBe(1);
    await page.getByRole('textbox').fill('Edited privately before saving.');
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/api/shares')
    );
    await page.getByRole('button', { name: 'Save privately' }).click();
    expect((await (await saved).json()).text).toBe(
      'Edited privately before saving.'
    );
    expect(saves).toBe(1);
  });
}

test('paused Review retains text and larger text fits without obstructing the editor', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await mockSpeech(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  await emit(page, 'speechResult', [['Paused final words.', true]]);
  await emit(page, 'speechEnd');
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('dock-375-paused.png')
  });
  await page.setViewportSize({ width: 390, height: 667 });
  await page.screenshot({
    path: testInfo.outputPath('dock-390-paused.png')
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addStyleTag({ content: 'html { font-size: 24px; }' });
  const panel = page.locator('.recording-panel');
  const review = page.getByRole('button', { name: 'Review', exact: true });
  await expect(review).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await expect
    .poll(() =>
      panel.evaluate(
        (el) =>
          parseFloat(
            document.documentElement.style.getPropertyValue(
              '--recording-dock-height'
            )
          ) >= el.getBoundingClientRect().height
      )
    )
    .toBe(true);
  await review.click();
  await expect(page.getByRole('textbox')).toBeFocused();
  await expect(panel).toHaveAttribute('data-visible', 'false');
  await expect(page.getByRole('textbox')).toHaveValue('Paused final words.');
  await page.getByRole('heading', { name: 'Record your share' }).focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  const finish = page.getByRole('button', { name: 'Finish & review' });
  await expect(finish).toBeVisible();
  const bounds = (await finish.boundingBox())!;
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});
test('inline microphone and dock hand off without restarting the recording', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await mockSpeech(page);
  await page.goto('/');
  const dock = page.locator('.recording-panel');
  const inline = page.locator('.inline-recorder');
  await expect(dock).toHaveAttribute('data-visible', 'true');
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  await emit(page, 'speechResult', [['Words before scrolling.', true]]);
  await inline.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(dock).toHaveAttribute('data-visible', 'false');
  await expect(dock).toHaveCSS('opacity', '0');
  const microphone = page.getByRole('button', { name: 'Stop listening' });
  await expect(microphone).toHaveCount(1);
  expect((await microphone.boundingBox())!.width).toBeGreaterThanOrEqual(132);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(dock).toHaveAttribute('data-visible', 'true');
  await expect(microphone).toHaveCount(1);
  expect((await microphone.boundingBox())!.width).toBe(64);
  await emit(page, 'speechResult', [
    ['Words before scrolling.', true],
    ['Words after scrolling.', true]
  ]);
  expect(
    await page.evaluate(() => Reflect.get(window, 'microphoneRequests'))
  ).toBe(1);
  await expect(page.getByRole('textbox')).toHaveValue(
    'Words before scrolling. Words after scrolling.'
  );
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(dock).toHaveAttribute('data-visible', 'false');
  await expect(microphone).toHaveCount(1);
  expect(
    await page.evaluate(() => Reflect.get(window, 'microphoneRequests'))
  ).toBe(1);
});

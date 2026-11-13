import { expect, test } from './fixtures/test';
import { mockSpeech, emit } from './fixtures/openai-browser';

for (const target of ['dock', 'editor']) {
  test(`${target} Save flushes recording, waits for cleanup, and saves exactly once`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await mockSpeech(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/shares', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const input = route.request().postDataJSON();
      expect(input.tidy).toBe(true);
      expect(input.text).toContain('Corrected final words.');
      await pending;
      const response = await route.fetch({
        postData: JSON.stringify({
          ...input,
          text: 'Earlier words. Corrected final words.',
          tidy: false
        })
      });
      await route.fulfill({ response });
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
    expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(125);
    await expect(
      panel.getByRole('button', { name: 'Save', exact: true })
    ).toHaveCount(0);
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
    await expect(
      page.getByRole('heading', { name: 'Preparing your share…' })
    ).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('preparing-share.png') });
    await expect(button).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Past shares', exact: true })
    ).toBeDisabled();
    await emit(page, 'speechResult', [
      ['Earlier words. '.repeat(30), true],
      ['Corrected final words.', true]
    ]);
    await emit(page, 'speechEnd');
    await expect(page.locator('textarea[aria-label="Your share"]')).toHaveValue(
      /Corrected final words\./
    );
    await expect(
      page.getByRole('heading', { name: 'Your share is saved.' })
    ).toHaveCount(0);
    await page.locator('form').evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect.poll(() => saves).toBe(1);
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

test('one recording timer survives pauses and dock handoffs; the microphone pulses unless motion is reduced', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.clock.install();
  await mockSpeech(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  const time = page.getByRole('timer');
  await expect(time).toHaveText('00:00');
  await expect(time).toHaveAttribute('aria-live', 'off');
  const ring = page
    .getByRole('button', { name: 'Stop listening' })
    .locator('..');
  await expect(ring).toHaveCSS('animation-name', 'recording-pulse');
  await page.clock.fastForward(2200);
  await expect(time).toHaveText('00:02');
  await page.screenshot({ path: testInfo.outputPath('recording-timer.png') });
  await page
    .locator('.inline-recorder')
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(time).toBeVisible();
  await expect(time).toHaveText('00:02');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(ring).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await emit(page, 'speechResult', [['Timer test words.', true]]);
  await emit(page, 'speechEnd');
  const paused = await page.getByLabel('Listening time').textContent();
  await page.clock.fastForward(5000);
  await expect(page.getByLabel('Listening time')).toHaveText(paused!);
  await expect(page.locator('.inline-recorder .microphone-ring')).toHaveCSS(
    'animation-name',
    'none'
  );
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  await page.clock.fastForward(1100);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('timer')).not.toHaveText(paused!);
  expect(
    await page.evaluate(() => Reflect.get(window, 'microphoneRequests'))
  ).toBe(2);
});

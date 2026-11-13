import { expect, test } from './fixtures/test';
import { mockSpeech, emit } from './fixtures/openai-browser';

test('mobile dock follows final and provisional words and reviews only after flushing', async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mockSpeech(page);
  await page.goto('/');
  const panel = page.locator('.recording-panel');
  const preview = page.getByRole('region', { name: 'Latest recognized words' });
  await expect(panel).toBeInViewport();
  await expect(
    panel.getByRole('button', { name: 'Review', exact: true })
  ).toHaveCount(0);
  const bounds = await panel.boundingBox();
  const mic = panel.getByRole('button', { name: 'Record your share' });
  expect((await mic.boundingBox())!.width).toBe(64);
  await mic.click();
  await emit(page, 'speechStart');
  await emit(page, 'speechResult', [
    ['Earlier fictional words. '.repeat(30), true],
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
  expect((await panel.boundingBox())!.height).toBe(bounds!.height);
  await panel.getByRole('button', { name: 'Finish & review' }).click();
  await expect(page.getByRole('textbox')).not.toBeFocused();
  await emit(page, 'speechResult', [
    ['Earlier fictional words. '.repeat(30), true],
    ['Corrected final words.', true]
  ]);
  await emit(page, 'speechEnd');
  await expect(page.getByRole('textbox')).toBeFocused();
  await expect(page.getByRole('textbox')).toHaveValue(
    /Earlier fictional words\.[\s\S]*Corrected final words\./
  );
  await expect(preview).not.toContainText('Latest provisional words');
  await expect(
    panel.getByRole('button', { name: 'Review', exact: true })
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('textbox')).toBeFocused();
  const save = page.getByRole('button', { name: 'Save privately' });
  await save.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  expect(
    (await save.boundingBox())!.y + (await save.boundingBox())!.height
  ).toBeLessThanOrEqual((await panel.boundingBox())!.y);
});

test('paused recording can be reviewed and resumed without losing the draft', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await mockSpeech(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  await emit(page, 'speechResult', [['Original final words.', true]]);
  await page.getByRole('button', { name: 'Stop listening' }).click();
  await emit(page, 'speechEnd');
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('textbox')).toBeFocused();
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  await emit(page, 'speechResult', [['Resumed final words.', true]]);
  await emit(page, 'speechEnd');
  await expect(page.getByRole('textbox')).toHaveValue(
    'Original final words.\n\nResumed final words.'
  );
  expect(
    await page.evaluate(() => Reflect.get(window, 'microphoneRequests'))
  ).toBe(2);
});

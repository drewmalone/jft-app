import { expect, test, type Page } from '@playwright/test';

async function mockSpeech(page: Page, prefixed = false) {
  await page.addInitScript(
    ({ prefixed }) => {
      class Speech {
        onstart?: () => void;
        onend?: () => void;
        onresult?: (event: unknown) => void;
        onerror?: (event: unknown) => void;
        static current: Speech;
        start() {
          Speech.current = this;
        }
        stop() {
          /* Tests explicitly emit final results before end. */
        }
        abort() {
          Object.assign(window, { aborted: true });
        }
      }
      Object.assign(window, {
        SpeechRecognition: prefixed ? undefined : Speech,
        webkitSpeechRecognition: prefixed ? Speech : undefined,
        speechStart: () => Speech.current.onstart?.(),
        speechEnd: () => Speech.current.onend?.(),
        speechError: (error: string) => Speech.current.onerror?.({ error }),
        speechResult: (segments: [string, boolean][]) =>
          Speech.current.onresult?.({
            resultIndex: 0,
            results: segments.map(([transcript, isFinal]) => ({
              isFinal,
              0: { transcript }
            }))
          }),
        captureStale: () => {
          const callback = Speech.current.onresult;
          Object.assign(window, {
            stale: () =>
              callback?.({
                resultIndex: 0,
                results: [
                  { isFinal: true, 0: { transcript: 'Stale fictional text' } }
                ]
              })
          });
        }
      });
    },
    { prefixed }
  );
}
async function emit(page: Page, name: string, value?: unknown) {
  await page.evaluate(({ name, value }) => Reflect.get(window, name)(value), {
    name,
    value
  });
}

test('dictation combines with editing, recovery, repeated sessions, saving, history and recipient reading', async ({
  page,
  browser,
  baseURL
}) => {
  await mockSpeech(page, true);
  await page.goto('/');
  await page.getByRole('textbox').fill('Typed fictional thought.');
  await page.getByRole('button', { name: 'Record your share' }).click();
  await expect(page.getByText('Waiting for microphone access…')).toBeVisible();
  await emit(page, 'speechStart');
  await emit(page, 'speechResult', [['Provisional fiction', false]]);
  await expect(
    page.getByText('Provisional fiction', { exact: false })
  ).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue(
    'Typed fictional thought.'
  );
  expect(
    await page.evaluate(() => sessionStorage.getItem('doorknob:share-draft'))
  ).toBe('Typed fictional thought.');
  await emit(page, 'speechResult', [
    ['Final fiction.', true],
    ['More provisional', false]
  ]);
  await emit(page, 'speechResult', [
    ['Final fiction.', true],
    ['More fiction.', true]
  ]);
  await page.getByRole('button', { name: 'Stop listening' }).click();
  await expect(
    page.getByRole('button', { name: 'Save privately' })
  ).toBeDisabled();
  await emit(page, 'speechEnd');
  const draft = 'Typed fictional thought.\n\nFinal fiction. More fiction.';
  await expect(page.getByRole('textbox')).toHaveValue(draft);
  await page.getByRole('textbox').fill(draft + ' Edited.');
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  await emit(page, 'speechResult', [['Another session.', true]]);
  await emit(page, 'speechEnd');
  const combined = draft + ' Edited.\n\nAnother session.';
  await page.reload();
  await expect(page.getByRole('textbox')).toHaveValue(combined);
  const savedResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/shares')
  );
  await page.getByRole('button', { name: 'Save privately' }).click();
  const saved = await (await savedResponse).json();
  expect(saved.kind).toBe('text');
  expect(saved.text).toBe(combined);
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Past shares', exact: true })
    .click();
  await expect(page.getByRole('listitem')).toContainText('Another session.');
  const recipient = await browser.newContext();
  try {
    const reader = await recipient.newPage();
    await reader.goto(new URL(saved.shareUrl, baseURL).href);
    await expect(reader.getByLabel('Shared thoughts')).toContainText(
      'Another session.'
    );
  } finally {
    await recipient.close();
  }
});

test('permission/service errors recover, navigation cleans up, stale callbacks are ignored', async ({
  page
}) => {
  await mockSpeech(page);
  await page.goto('/');
  for (const error of ['not-allowed', 'network']) {
    await page.getByRole('button', { name: 'Record your share' }).click();
    await emit(page, 'speechError', error);
    await expect(
      page.getByText(
        error === 'not-allowed'
          ? /Microphone access was denied/
          : /Speech recognition could not continue/
      )
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  await emit(page, 'captureStale');
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Past shares' })
    .click();
  expect(await page.evaluate(() => Reflect.get(window, 'aborted'))).toBe(true);
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Today’s reflection' })
    .click();
  await emit(page, 'stale');
  await expect(page.getByRole('textbox')).toHaveValue('');
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechEnd');
  await expect(page.getByText(/Microphone stopped/)).toBeVisible();
});

test('unsupported browsers keep typing and saving', async ({ page }) => {
  await page.addInitScript(() =>
    Object.assign(window, {
      SpeechRecognition: undefined,
      webkitSpeechRecognition: undefined
    })
  );
  await page.goto('/');
  await expect(
    page.getByText(/Voice transcription is not available/)
  ).toBeVisible();
  await page.getByRole('textbox').fill('Fictional typed fallback.');
  await page.getByRole('button', { name: 'Save privately' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your share is saved.' })
  ).toBeVisible();
});

test('dictation limit stops recognition and retains the draft without accepting stale results', async ({
  page
}) => {
  await mockSpeech(page);
  await page.goto('/');
  await page.getByRole('textbox').fill('🌱'.repeat(9995));
  await page.getByRole('button', { name: 'Record your share' }).click();
  await emit(page, 'speechStart');
  await emit(page, 'captureStale');
  await emit(page, 'speechResult', [['Fictional speech beyond limit.', true]]);
  await expect(
    page.getByText(/reached the 10,000 character limit/)
  ).toBeVisible();
  await emit(page, 'stale');
  expect(await page.getByRole('textbox').inputValue()).toBe(
    '🌱'.repeat(9995) + '\n\nFic'
  );
  expect(await page.evaluate(() => Reflect.get(window, 'aborted'))).toBe(true);
});

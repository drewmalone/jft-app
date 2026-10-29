import { expect, test } from './fixtures/test';

declare global {
  interface Window {
    xaiFixture: { stopped: number; socket?: { emit(value: unknown): void } };
  }
}

test('xAI runtime bootstrap drives normalized recording, Stop, cleanup, recovery and explicit saving', async ({
  page
}) => {
  test.skip(
    process.env.STT_PROVIDER !== 'xai',
    'Run this isolated case with the documented synthetic xAI relay configuration.'
  );
  let sessions = 0;
  await page.route('**/api/transcription/session', (route) => {
    sessions++;
    expect(route.request().headers()['x-stt-provider']).toBe('xai');
    return route.fulfill({
      json: {
        provider: 'xai',
        relay_url: 'wss://relay.example/stt',
        value: 'fictional-ticket',
        expires_at: 9999999999
      }
    });
  });
  await page.route('**/api/shares/cleanup', (route) =>
    route.fulfill({ json: { text: route.request().postDataJSON().text } })
  );
  await page.addInitScript(() => {
    const fixture = { stopped: 0, socket: undefined as Socket | undefined };
    Object.assign(window, { xaiFixture: fixture });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [
            {
              onended: null,
              stop: () => {
                fixture.stopped++;
              }
            }
          ]
        })
      }
    });
    class Socket {
      readyState = 1;
      bufferedAmount = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror = null;
      onclose = null;
      constructor() {
        fixture.socket = this;
        setTimeout(() => this.onopen?.(), 0);
      }
      emit(value: unknown) {
        this.onmessage?.({ data: JSON.stringify(value) });
      }
      send(value: string | ArrayBuffer) {
        if (typeof value !== 'string') return;
        const message = JSON.parse(value);
        if (message.type === 'authenticate')
          setTimeout(() => this.emit({ type: 'ready' }), 0);
        if (message.type === 'stop') {
          this.emit({ type: 'final', text: 'Trailing words.' });
          this.emit({ type: 'ended' });
        }
      }
      close() {
        this.readyState = 3;
      }
    }
    class Context {
      state = 'running';
      sampleRate = 48_000;
      onstatechange = null;
      destination = {};
      audioWorklet = { addModule: async () => {} };
      async resume() {}
      async close() {}
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createGain() {
        return { gain: { value: 0 }, connect() {}, disconnect() {} };
      }
    }
    class Worklet {
      onprocessorerror = null;
      port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: () =>
          queueMicrotask(() => {
            this.port.onmessage?.({ data: new ArrayBuffer(128) });
            this.port.onmessage?.({ data: 'stopped' });
          }),
        close() {}
      };
      connect() {}
      disconnect() {}
    }
    Object.assign(window, {
      WebSocket: Socket,
      AudioContext: Context,
      AudioWorkletNode: Worklet
    });
  });
  await page.goto('/');
  await page.getByRole('textbox').fill('Typed thought.');
  expect(sessions).toBe(0);
  expect(await page.evaluate(() => window.xaiFixture.stopped)).toBe(0);
  await page.getByRole('button', { name: 'Record your share' }).click();
  await expect(
    page.getByRole('button', { name: 'Stop listening' })
  ).toBeVisible();
  await page.evaluate(() =>
    window.xaiFixture.socket!.emit({
      type: 'interim',
      text: 'Provisional words'
    })
  );
  await expect(
    page.getByText('Provisional words', { exact: false })
  ).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue('Typed thought.');
  await page.evaluate(() =>
    window.xaiFixture.socket!.emit({ type: 'final', text: 'Final words.' })
  );
  await page.getByRole('button', { name: 'Stop listening' }).click();
  const first = 'Typed thought.\n\nFinal words. Trailing words.';
  await expect(page.getByRole('textbox')).toHaveValue(first);
  await expect(
    page.getByRole('button', { name: 'Save privately' })
  ).toBeEnabled();
  expect(await page.evaluate(() => window.xaiFixture.stopped)).toBe(1);
  await page.getByRole('button', { name: 'Record your share' }).click();
  await expect(
    page.getByRole('button', { name: 'Stop listening' })
  ).toBeVisible();
  await page.evaluate(() => {
    window.xaiFixture.socket!.emit({ type: 'final', text: 'More words.' });
    window.xaiFixture.socket!.emit({ type: 'error' });
  });
  await expect(
    page.getByText(/Speech recognition could not continue/)
  ).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue(
    first + '\n\nMore words.'
  );
  expect(await page.evaluate(() => window.xaiFixture.stopped)).toBe(2);
  expect(sessions).toBe(2);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/shares') &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Save privately' }).click();
  expect((await (await saved).json()).text).toBe(first + '\n\nMore words.');
});

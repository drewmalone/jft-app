/* Mono PCM16 little-endian, 100 ms frames. No recordings or audio playback. */
class DoorknobPcm extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.samples = new Float32Array(processorOptions.samplesPerFrame);
    this.used = 0;
    this.live = true;
    this.port.onmessage = (event) => {
      if (event.data === 'stop') {
        this.flush();
        this.live = false;
        this.port.postMessage('stopped');
      }
    };
  }
  flush() {
    if (!this.used) return;
    const buffer = new ArrayBuffer(this.used * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < this.used; i++) {
      const value = Math.max(-1, Math.min(1, this.samples[i]));
      view.setInt16(i * 2, value < 0 ? value * 32768 : value * 32767, true);
    }
    this.used = 0;
    this.port.postMessage(buffer, [buffer]);
  }
  process(inputs) {
    if (!this.live) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i];
      this.samples[this.used++] = value / channels.length;
      if (this.used === this.samples.length) this.flush();
    }
    return true;
  }
}
registerProcessor('doorknob-pcm', DoorknobPcm);

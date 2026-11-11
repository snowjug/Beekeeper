/* global AudioWorkletProcessor, registerProcessor */
// Collects the microphone into 100 ms mono Float32 chunks (1600 samples at 16 kHz) and posts them
// to the main thread, where they are fed to the speech recognizer.
class BeekeeperCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(1600);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const count = Math.min(channel.length - offset, this.chunk.length - this.filled);
        this.chunk.set(channel.subarray(offset, offset + count), this.filled);
        this.filled += count;
        offset += count;
        if (this.filled === this.chunk.length) {
          const copy = this.chunk.slice(0);
          this.port.postMessage(copy, [copy.buffer]);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('beekeeper-capture', BeekeeperCaptureProcessor);

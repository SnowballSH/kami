const FULL_SCALE = 0x7fff;

/** Deepgram's `linear16`: signed 16-bit little-endian samples, clipped rather than wrapped. */
export const toPcm16 = (samples: Float32Array): Uint8Array<ArrayBuffer> => {
  const frame = new DataView(new ArrayBuffer(samples.length * Int16Array.BYTES_PER_ELEMENT));
  for (const [index, sample] of samples.entries()) {
    const clipped = Math.max(-1, Math.min(1, sample));
    frame.setInt16(index * Int16Array.BYTES_PER_ELEMENT, Math.round(clipped * FULL_SCALE), true);
  }
  return new Uint8Array(frame.buffer);
};

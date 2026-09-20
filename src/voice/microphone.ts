import { toPcm16 } from "./pcm";
import type { Microphone, MicrophoneDeafness, MicrophoneSession } from "./types";

const TAP_NAME = "kami-pcm-tap";

/** Runs on the audio thread: hands every block of samples to the page as it is captured. */
const TAP_SOURCE = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel !== undefined) this.port.postMessage(new Float32Array(channel));
    return true;
  }
}
registerProcessor(${JSON.stringify(TAP_NAME)}, PcmTap);
`;

let tapUrl: string | null = null;

const tapModuleUrl = (): string => {
  tapUrl ??= URL.createObjectURL(new Blob([TAP_SOURCE], { type: "text/javascript" }));
  return tapUrl;
};

/** One microphone, opened per press and closed on release: never an open mic (`docs/spec.md`). */
export class BrowserMicrophone implements Microphone {
  async open(
    onAudio: (frame: Uint8Array<ArrayBuffer>) => void,
  ): Promise<MicrophoneSession | MicrophoneDeafness> {
    const media = navigator.mediaDevices;
    if (media === undefined) return window.isSecureContext ? "refused" : "insecure";
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await media.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      context = new AudioContext();
      await context.resume();
      await context.audioWorklet.addModule(tapModuleUrl());
      const tap = new AudioWorkletNode(context, TAP_NAME, { numberOfOutputs: 0 });
      tap.port.onmessage = (event: MessageEvent<Float32Array>) => onAudio(toPcm16(event.data));
      context.createMediaStreamSource(stream).connect(tap);
      const { sampleRate } = context;
      const closing = context;
      const listening = stream;
      return {
        sampleRate,
        close: async () => {
          tap.port.onmessage = null;
          tap.disconnect();
          for (const track of listening.getTracks()) track.stop();
          await closing.close();
        },
      };
    } catch {
      for (const track of stream?.getTracks() ?? []) track.stop();
      await context?.close();
      return "refused";
    }
  }
}

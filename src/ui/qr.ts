import { toCanvas } from "qrcode";

const QR_PX = 176;
const QR_MARGIN_MODULES = 1;

/** Paints `text` as a QR code into `canvas`, in the board's ink on the board's white. */
export type QrPainter = (canvas: HTMLCanvasElement, text: string) => Promise<void>;

export const paintQr: QrPainter = (canvas, text) =>
  toCanvas(canvas, text, {
    width: QR_PX,
    margin: QR_MARGIN_MODULES,
    color: { dark: "#111111ff", light: "#ffffffff" },
  });

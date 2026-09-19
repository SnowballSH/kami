export const TAU = Math.PI * 2;

export const context2d = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("Kami's renderer needs a 2D canvas context, and this canvas has none to give.");
  }
  return ctx;
};

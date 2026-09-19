import { svgEl } from "./dom";

const ICON_VIEW_BOX = "0 0 24 24";

const ICON_PATHS = {
  eraser: ["M4 15 13 5l7 6-9 10H8Z", "M9 9.5l7 6", "M4 21h16"],
  reset: ["M19 12a7 7 0 1 1-2.05-4.95", "M19 3.5v4.5h-4.5"],
  cat: ["M3 8c2 11 16 11 18 0", "M3 8c5 4 13 4 18 0", "M8 10.8v4.6M12 11.2v5.2M16 10.8v4.6"],
  sound: ["M4 9v6h4l5 4V5L8 9Z", "M16.5 9a4.5 4.5 0 0 1 0 6", "M19 6.5a8 8 0 0 1 0 11"],
  muted: ["M4 9v6h4l5 4V5L8 9Z", "M16.5 9.5l5 5M21.5 9.5l-5 5"],
  quill: ["M20 4c-7 0-12 5-13 13l-3 3", "M7 17c6 0 10-4 11-10", "M11 13l3 3"],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICON_PATHS;

export const icon = (name: IconName): SVGElement =>
  svgEl(
    "svg",
    { viewBox: ICON_VIEW_BOX, class: `kami-icon kami-icon-${name}`, "aria-hidden": "true" },
    ICON_PATHS[name].map((d) => svgEl("path", { d })),
  );

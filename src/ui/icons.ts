import { svgEl } from "./dom";

const ICON_VIEW_BOX = "0 0 24 24";

const ICON_PATHS = {
  draw: ["M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1Z", "M14.5 6.5l3 3"],
  write: ["M5 7V4h14v3", "M12 4v16", "M9 20h6"],
  erase: ["M4 15 13 5l7 6-9 10H8Z", "M9 9.5l7 6", "M4 21h16"],
  clear: ["M4 17h16", "M7 17l1.5-10h7L17 17", "M9 4h6", "M5 21h14"],
  pan: [
    "M18 11V6a2 2 0 0 0-4 0",
    "M14 10V4a2 2 0 0 0-4 0v2",
    "M10 10.5V6a2 2 0 0 0-4 0v8",
    "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
  ],
  minus: ["M5 12h14"],
  plus: ["M5 12h14", "M12 5v14"],
  recenter: ["M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10Z", "M12 2v5", "M12 17v5", "M2 12h5", "M17 12h5"],
  chevron: ["M7 10l5 5 5-5"],
  cat: [
    "M5 10 5.5 4.5 9.5 7.5a8 8 0 0 1 5 0L18.5 4.5 19 10a7 7 0 1 1-14 0Z",
    "M9.5 11.5v1",
    "M14.5 11.5v1",
    "M12 14.5v1.5",
    "M9 17c1 1 5 1 6 0",
  ],
  ear: [
    "M8.5 9a3.5 3.5 0 1 1 7 0c0 2.5-2.5 3-3 5",
    "M12.5 17v.5",
    "M6 9a6 6 0 1 1 8.5 5.5c-1.5.8-2 1.6-2 3A2.5 2.5 0 0 1 8 18.5",
  ],
  tidy: [
    "M11 4l1.6 4.4L17 10l-4.4 1.6L11 16l-1.6-4.4L5 10l4.4-1.6Z",
    "M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z",
  ],
  walker: [
    "M12 3.5a1.75 1.75 0 1 0 0 3.5a1.75 1.75 0 0 0 0-3.5Z",
    "M12 7v6.5",
    "M8 11l4-2 4 2.5",
    "M12 13.5l-3.5 7",
    "M12 13.5l3.5 7",
  ],
  share: ["M12 15V4", "M8 8l4-4 4 4", "M5 13v6h14v-6"],
  home: ["M4 11.5 12 4l8 7.5", "M6 10v10h12V10", "M10 20v-6h4v6"],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICON_PATHS;

export const icon = (name: IconName): SVGElement =>
  svgEl(
    "svg",
    { viewBox: ICON_VIEW_BOX, class: `kami-icon kami-icon-${name}`, "aria-hidden": "true" },
    ICON_PATHS[name].map((d) => svgEl("path", { d })),
  );

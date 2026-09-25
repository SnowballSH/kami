/** Where a route of the Kami's Eye sidecar lives, given KAMI_RECOGNIZER_URL (see ml/CONTRACT.md). */
export type SidecarRoute = "health" | "recognize" | "complete";

export const sidecarUrl = (baseUrl: string, route: SidecarRoute): string =>
  `${baseUrl.replace(/\/+$/, "")}/${route}`;

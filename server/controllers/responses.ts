export const CROSS_ORIGIN_HEADERS = { "access-control-allow-origin": "*" } as const;

export const noContent = (): Response =>
  new Response(null, { status: 204, headers: CROSS_ORIGIN_HEADERS });

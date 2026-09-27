export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const browserFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

export const API_BASE = "/api";

export type EntityKind = "drawings" | "notes" | "rules";

export const boardsPath = (): string => `${API_BASE}/boards`;

export const boardPath = (boardId: string): string =>
  `${boardsPath()}/${encodeURIComponent(boardId)}`;

export const entityPath = (boardId: string, kind: EntityKind, id: string): string =>
  `${boardPath(boardId)}/${kind}/${encodeURIComponent(id)}`;

export const compilePath = (): string => `${API_BASE}/compile`;

export const scenePath = (): string => `${API_BASE}/scene`;

export const transcribePath = (): string => `${API_BASE}/transcribe`;

export const exemplarsPath = (): string => `${API_BASE}/exemplars`;

export const exemplarPath = (word: string): string =>
  `${API_BASE}/exemplar?${new URLSearchParams({ word })}`;

export const recognizePath = (): string => `${API_BASE}/recognize`;

export const beautifyPath = (): string => `${API_BASE}/beautify`;

export const JSON_HEADERS = { "content-type": "application/json" } as const;

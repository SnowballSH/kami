import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiSession, type Connection, type SessionStatus } from "../persistence/session";
import { enterGame } from "./accessGate";

const SHARED: SessionStatus = {
  mode: "shared",
  authenticated: false,
  boards: [],
  controllers: [],
};
const GRANTED: SessionStatus = {
  ...SHARED,
  authenticated: true,
  boards: ["my board"],
  controllers: ["my-stick"],
};
const root = (): HTMLElement => {
  const element = document.createElement("main");
  document.body.append(element);
  return element;
};

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("API session entry", () => {
  it("starts the same-origin demo without requesting a token or changing the URL", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ ...SHARED, mode: "demo", authenticated: true }),
    );
    const start = vi.fn();
    const app = root();
    await enterGame(app, start, new ApiSession(fetch));
    expect(start).toHaveBeenCalledWith(app, { online: true });
    expect(app.querySelector("form")).toBeNull();
    expect(window.location.search).toBe("");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("waits for shared authentication, clears the token, and starts with granted board/controller defaults", async () => {
    let status = SHARED;
    const calls: { path: string; init?: RequestInit }[] = [];
    const session = new ApiSession(async (path, init) => {
      calls.push({ path, ...(init === undefined ? {} : { init }) });
      if (init?.method === "POST") {
        status = GRANTED;
        return Response.json({ ok: true });
      }
      return Response.json(status);
    });
    const start = vi.fn<(root: HTMLElement, connection: Connection) => void>();
    const app = root();
    await enterGame(app, start, session);
    expect(start).not.toHaveBeenCalled();
    const input = app.querySelector("input");
    const form = app.querySelector("form");
    if (input === null || form === null) throw new Error("Missing sign-in form");
    input.value = "test-only-token";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(input.value).toBe("");
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    expect(new URLSearchParams(window.location.search).get("board")).toBe("my board");
    expect(new URLSearchParams(window.location.search).get("controller")).toBe("my-stick");
    expect(calls.map(({ path }) => path)).toEqual(["/api/session", "/api/session", "/api/session"]);
    expect(calls[1]?.init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer test-only-token" },
    });
    expect(calls[1]?.init?.body).toBeUndefined();
    const connection = start.mock.calls[0]?.[1];
    expect(connection?.online).toBe(true);
    await connection?.signOut?.();
    expect(calls.at(-1)?.init?.method).toBe("DELETE");
  });

  it("preserves explicitly selected board and controller URLs", async () => {
    window.history.replaceState(null, "", "/?board=chosen&controller=off");
    await enterGame(root(), vi.fn(), new ApiSession(async () => Response.json(GRANTED)));
    expect(window.location.search).toBe("?board=chosen&controller=off");
  });

  it("keeps the game closed and allows retry when authentication or the server fails", async () => {
    const fetch = vi.fn(async () => Response.json(SHARED));
    const start = vi.fn();
    const app = root();
    const session = new ApiSession(fetch);
    await enterGame(app, start, session);
    fetch.mockResolvedValue(new Response(null, { status: 401 }));
    const form = app.querySelector("form");
    if (form === null) throw new Error("Missing sign-in form");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(app.querySelector('[role="status"]')?.textContent).toContain("Sign-in failed"),
    );
    expect(app.querySelector("button")?.disabled).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(app.querySelector("input")?.value).toBe("");
    const offline = root();
    await enterGame(
      offline,
      start,
      new ApiSession(async () => {
        throw new Error("offline");
      }),
    );
    expect(offline.textContent).toContain("Please retry");
    expect(start).not.toHaveBeenCalled();
    offline.querySelector<HTMLButtonElement>('button[type="button"]')?.click();
    expect(start).toHaveBeenCalledWith(offline, { online: false });
  });
});

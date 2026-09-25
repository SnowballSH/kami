import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiSession, type Connection, type SessionStatus } from "../persistence/session";
import { enterGame } from "./accessGate";

const SHARED: SessionStatus = {
  mode: "shared",
  authenticated: false,
  boards: [],
  controllers: [],
  secret: "token",
  unrestricted: false,
};
const GRANTED: SessionStatus = {
  ...SHARED,
  authenticated: true,
  boards: ["my board"],
  controllers: ["my-stick"],
};
const PASSWORD_GATE: SessionStatus = { ...SHARED, secret: "password" };
const PASSWORD_GRANTED: SessionStatus = {
  ...PASSWORD_GATE,
  authenticated: true,
  unrestricted: true,
};
const root = (): HTMLElement => {
  const element = document.createElement("main");
  document.body.append(element);
  return element;
};
const formOf = (app: HTMLElement) => {
  const form = app.querySelector("form");
  const input = app.querySelector<HTMLInputElement>("#kami-secret");
  if (form === null || input === null) throw new Error("Missing sign-in form");
  return {
    input,
    submit: (value: string) => {
      input.value = value;
      form.dispatchEvent(new Event("submit", { cancelable: true }));
    },
    status: () => app.querySelector('[role="status"]')?.textContent ?? "",
  };
};

interface Call {
  readonly path: string;
  readonly init?: RequestInit;
}

/** A server that answers the session check with `status` until a sign-in `accept`s. */
const fakeServer = (
  gate: SessionStatus,
  granted: SessionStatus,
  accept: (init: RequestInit) => boolean,
) => {
  let status = gate;
  const calls: Call[] = [];
  const session = new ApiSession(async (path, init) => {
    calls.push({ path, ...(init === undefined ? {} : { init }) });
    if (init?.method === "POST") {
      if (!accept(init)) return new Response(null, { status: 401 });
      status = granted;
      return Response.json({ ok: true });
    }
    return Response.json(status);
  });
  return { session, calls };
};

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("API session entry", () => {
  it("starts the same-origin demo without requesting a token or changing the URL", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ ...SHARED, mode: "demo", authenticated: true, secret: null }),
    );
    const start = vi.fn();
    const app = root();
    await enterGame(app, start, new ApiSession(fetch));
    expect(start).toHaveBeenCalledWith(app, { online: true });
    expect(app.querySelector("form")).toBeNull();
    expect(window.location.search).toBe("");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("asks for a token when an older server does not say which secret it wants", async () => {
    const app = root();
    const { secret: _, unrestricted: __, ...legacy } = SHARED;
    await enterGame(app, vi.fn(), new ApiSession(async () => Response.json(legacy)));
    expect(app.querySelector("label")?.textContent).toBe("Access token");
    expect(app.querySelector<HTMLInputElement>("#kami-secret")?.autocomplete).toBe("off");
  });

  it("waits for shared authentication, clears the token, and starts with granted board/controller defaults", async () => {
    const { session, calls } = fakeServer(SHARED, GRANTED, () => true);
    const start = vi.fn<(root: HTMLElement, connection: Connection) => void>();
    const app = root();
    await enterGame(app, start, session);
    expect(start).not.toHaveBeenCalled();
    const form = formOf(app);
    form.submit("test-only-token");
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    expect(form.input.value).toBe("");
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

  it("asks for a password a password manager can fill, and sends it in the body", async () => {
    const { session, calls } = fakeServer(
      PASSWORD_GATE,
      PASSWORD_GRANTED,
      (init) => init.body === JSON.stringify({ password: "correct horse" }),
    );
    const start = vi.fn();
    const app = root();
    await enterGame(app, start, session);
    const form = formOf(app);
    expect(app.querySelector("label")?.textContent).toBe("Password");
    expect(form.input.type).toBe("password");
    expect(form.input.autocomplete).toBe("current-password");
    expect(form.input.name).toBe("password");
    expect(document.activeElement).toBe(form.input);
    expect(app.querySelector<HTMLInputElement>('input[autocomplete="username"]')?.value).toBe(
      "kami",
    );
    expect(app.querySelector('button[type="submit"]')?.textContent).toBe("Open Kami");
    expect(form.status()).toContain("password");
    expect(form.status()).not.toContain("token");
    form.submit("correct horse");
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    expect(calls[1]?.init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(calls[1]?.init?.headers).not.toHaveProperty("authorization");
    expect(window.location.search).toBe("");
  });

  it("says a wrong password is wrong, clears it, and lets the player try again", async () => {
    const { session } = fakeServer(
      PASSWORD_GATE,
      PASSWORD_GRANTED,
      (init) => init.body === JSON.stringify({ password: "right" }),
    );
    const start = vi.fn();
    const app = root();
    await enterGame(app, start, session);
    const form = formOf(app);
    form.submit("wrong");
    await vi.waitFor(() => expect(form.status()).toBe("Wrong password. Check it and try again."));
    expect(form.input.value).toBe("");
    expect(form.input.getAttribute("aria-invalid")).toBe("true");
    expect(app.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    expect(start).not.toHaveBeenCalled();
    form.submit("right");
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  });

  it("reports throttled sign-ins with the wait the server asks for", async () => {
    const session = new ApiSession(async (_, init) =>
      init?.method === "POST"
        ? new Response(null, { status: 429, headers: { "retry-after": "600" } })
        : Response.json(PASSWORD_GATE),
    );
    const app = root();
    await enterGame(app, vi.fn(), session);
    const form = formOf(app);
    form.submit("guess");
    await vi.waitFor(() =>
      expect(form.status()).toBe("Too many sign-in attempts. Try again in 10 minutes."),
    );
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
    const form = formOf(app);
    form.submit("   ");
    expect(form.status()).toBe("Enter the access token first.");
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockResolvedValue(new Response(null, { status: 401 }));
    form.submit("not-the-token");
    await vi.waitFor(() => expect(form.status()).toContain("Sign-in failed"));
    expect(app.querySelector("button")?.disabled).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(form.input.value).toBe("");
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

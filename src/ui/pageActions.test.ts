import { afterEach, describe, expect, it, vi } from "vitest";
import { homeUrl, PageActions } from "./pageActions";

describe("PageActions", () => {
  afterEach(() => document.body.replaceChildren());

  it("goes back to the start on one tap", () => {
    const wentHome = vi.fn();
    const actions = new PageActions({ goHome: wentHome, restartRun: vi.fn(), signedOut: vi.fn() });
    document.body.append(actions.element);
    actions.element.querySelector<HTMLButtonElement>(".kami-page-home")?.click();
    expect(wentHome).toHaveBeenCalledTimes(1);
  });

  it("offers no sign-out unless the session can end", () => {
    const actions = new PageActions({ goHome: vi.fn(), restartRun: vi.fn(), signedOut: vi.fn() });
    expect(actions.element.querySelector(".kami-page-sign-out")).toBeNull();
  });

  it("signs out beside home, and says so when it fails so it can be tried again", async () => {
    const signOut = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("offline"));
    signOut.mockResolvedValueOnce(undefined);
    const signedOut = vi.fn();
    const actions = new PageActions({ goHome: vi.fn(), restartRun: vi.fn(), signOut, signedOut });
    const button = actions.element.querySelector<HTMLButtonElement>(".kami-page-sign-out");
    if (button === null) throw new Error("Missing sign-out");
    expect(button.getAttribute("aria-label")).toBe("Sign out");

    button.click();
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(signOut).toHaveBeenCalledOnce();
    expect(button.getAttribute("aria-label")).toBe("Sign-out failed — tap to retry");
    expect(signedOut).not.toHaveBeenCalled();

    button.click();
    await vi.waitFor(() => expect(signedOut).toHaveBeenCalledOnce());
  });

  it("offers a staged run's restart only when asked, and restarts on the second tap", () => {
    const restartRun = vi.fn();
    const actions = new PageActions({ goHome: vi.fn(), restartRun, signedOut: vi.fn() });
    const restart = actions.element.querySelector<HTMLButtonElement>(".kami-page-restart");
    if (restart === null) throw new Error("Missing restart");
    expect(restart.hidden).toBe(true);

    actions.showRestart(true);
    expect(restart.hidden).toBe(false);
    restart.click();
    expect(restartRun).not.toHaveBeenCalled();
    expect(restart.getAttribute("aria-label")).toBe("Tap again to start the run over");
    restart.click();
    expect(restartRun).toHaveBeenCalledOnce();
    expect(restart.getAttribute("aria-label")).toBe("Start the run over");
  });

  it("names the start screen: this page without mode, board or anything else", () => {
    expect(homeUrl({ origin: "http://box:8787", pathname: "/" })).toBe("http://box:8787/");
  });
});

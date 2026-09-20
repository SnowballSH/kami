import { afterEach, describe, expect, it, vi } from "vitest";
import { homeUrl, PageActions } from "./pageActions";

describe("PageActions", () => {
  afterEach(() => document.body.replaceChildren());

  it("goes back to the start on one tap", () => {
    const wentHome = vi.fn();
    const actions = new PageActions(wentHome);
    document.body.append(actions.element);
    actions.element.querySelector<HTMLButtonElement>(".kami-page-home")?.click();
    expect(wentHome).toHaveBeenCalledTimes(1);
  });

  it("names the start screen: this page without mode, board or anything else", () => {
    expect(homeUrl({ origin: "http://box:8787", pathname: "/" })).toBe("http://box:8787/");
  });
});

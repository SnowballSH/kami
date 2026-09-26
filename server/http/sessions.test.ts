// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PASSWORD_GRANT } from "./accessConfig";
import { MAX_SESSIONS, Sessions } from "./sessions";

const withCookie = (setCookie: string): Request =>
  new Request("https://kami.test/api/session", {
    headers: { cookie: setCookie.split(";")[0] ?? "" },
  });

describe("Sessions", () => {
  it("makes room for a new session at capacity by ending the oldest", () => {
    const sessions = new Sessions([]);
    const cookies = Array.from({ length: MAX_SESSIONS + 1 }, () => sessions.create(PASSWORD_GRANT));
    const [first = "", second = ""] = cookies;
    const newest = cookies.at(-1) ?? "";
    expect(newest).toMatch(/^__Host-kami=[0-9a-f]{64};/);
    expect(sessions.grant(withCookie(first))).toBeNull();
    expect(sessions.grant(withCookie(second))).toEqual(PASSWORD_GRANT);
    expect(sessions.grant(withCookie(newest))).toEqual(PASSWORD_GRANT);
  });
});

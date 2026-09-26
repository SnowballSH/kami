// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type Grant, PASSWORD_GRANT } from "./accessConfig";
import { MAX_SESSIONS, Sessions } from "./sessions";

const withCookie = (setCookie: string): Request =>
  new Request("https://kami.test/api/session", {
    headers: { cookie: setCookie.split(";")[0] ?? "" },
  });

const scoped = (id: string, boards: readonly string[], models = false): Grant => ({
  id,
  boards,
  controllers: [],
  models,
});
const ARCADE = scoped("arcade", ["arcade"]);
const ARCADE_AND_LAB = scoped("arcade-and-lab", ["arcade", "lab"], true);
const LAB = scoped("lab", ["lab"]);

const fill = (sessions: Sessions, grant: Grant, count = MAX_SESSIONS): string[] =>
  Array.from({ length: count }, () => sessions.create(grant) ?? "");

describe("Sessions", () => {
  it("makes room for a new session at capacity by ending the oldest of the same grant", () => {
    const sessions = new Sessions([]);
    const cookies = fill(sessions, PASSWORD_GRANT, MAX_SESSIONS + 1);
    const [first = "", second = ""] = cookies;
    const newest = cookies.at(-1) ?? "";
    expect(newest).toMatch(/^__Host-kami=[0-9a-f]{64};/);
    expect(sessions.grant(withCookie(first))).toBeNull();
    expect(sessions.grant(withCookie(second))).toEqual(PASSWORD_GRANT);
    expect(sessions.grant(withCookie(newest))).toEqual(PASSWORD_GRANT);
  });

  it("ends the oldest session of the same grant before any older one of another", () => {
    const sessions = new Sessions([]);
    const [wide = ""] = fill(sessions, PASSWORD_GRANT, 1);
    const [firstArcade = "", secondArcade = ""] = fill(sessions, ARCADE, MAX_SESSIONS - 1);
    expect(sessions.create(ARCADE)).not.toBeNull();
    expect(sessions.grant(withCookie(wide))).toEqual(PASSWORD_GRANT);
    expect(sessions.grant(withCookie(firstArcade))).toBeNull();
    expect(sessions.grant(withCookie(secondArcade))).toEqual(ARCADE);
  });

  it("lets a grant end a narrower one when none of its own is open", () => {
    const sessions = new Sessions([]);
    const [arcade = ""] = fill(sessions, ARCADE, 1);
    const [firstLab = ""] = fill(sessions, LAB, MAX_SESSIONS - 1);
    expect(sessions.create(ARCADE_AND_LAB)).not.toBeNull();
    expect(sessions.grant(withCookie(arcade))).toBeNull();
    expect(sessions.grant(withCookie(firstLab))).toEqual(LAB);
    expect(sessions.create(PASSWORD_GRANT)).not.toBeNull();
    expect(sessions.grant(withCookie(firstLab))).toBeNull();
  });

  it("never lets a narrower or unrelated grant end a wider one, and refuses it instead", () => {
    const sessions = new Sessions([]);
    const wide = fill(sessions, PASSWORD_GRANT, MAX_SESSIONS / 2);
    const broad = fill(sessions, ARCADE_AND_LAB, MAX_SESSIONS / 2);
    expect(sessions.create(ARCADE)).toBeNull();
    expect(sessions.create(LAB)).toBeNull();
    for (const cookie of [...wide, ...broad])
      expect(sessions.grant(withCookie(cookie))).not.toBeNull();
  });
});

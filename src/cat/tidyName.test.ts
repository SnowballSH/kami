import { describe, expect, it } from "vitest";
import { tidyName } from "./tidyName";

describe("tidyName", () => {
  it.each([
    ["  It's a Bouncy Mushroom!  ", "a bouncy mushroom"],
    ["this is an anvil", "an anvil"],
    ["That’s obviously a cloud.", "a cloud"],
    ["um, I think it's like a ladder", "a ladder"],
    ["umbrella", "an umbrella"],
    ["unicorn", "a unicorn"],
    ["the queen of hearts", "the queen of hearts"],
    ["very bouncy", "something very bouncy"],
    ['"EAT ME"', "eat me"],
    ["stairs", "stairs"],
    ["honey", "honey"],
    ["alice's cake", "alice's cake"],
    ["cup of tea", "a cup of tea"],
    ["stairs to heaven", "stairs to heaven"],
    ["draw a ladder to the ledge", "a ladder to the ledge"],
    ["make Alice a cake", "make alice a cake"],
    ["", "a scribble"],
    ["it's", "a scribble"],
  ])("%j becomes %j", (utterance, name) => {
    expect(tidyName(utterance)).toBe(name);
  });
});

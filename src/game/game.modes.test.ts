import { beforeEach, describe, expect, it } from "vitest";
import { boardFor } from "../board";
import { ENDLESS_STRIP as ENDLESS_GROUND } from "../board/boards/endless";
import { OFFER_HELP } from "../cat/lines";
import { boundsOf, poseToWorld, rectsOverlap, type Vec } from "../core/geometry";
import { BRIDGE_LINE, DROP_LINE, IDEAS, LADDER_LINE } from "../counsel";
import {
  BOSS_MODE,
  FIRST_PUZZLE_BOARD_ID,
  NOTHING_HUNGRY_LINE,
  PUZZLE_MODE,
  PUZZLE_ROOMS,
  SANDBOX_MODE,
} from "../modes";
import { figureAround, legsBelow, ringAround } from "../sim/boss/figure.testSupport";
import { drawingOf } from "../sim/testSupport";
import { ROOM_CARD_SHOWN_MS } from "../ui/roomCard";
import { titleCardShownMs } from "../ui/titleCard";
import {
  HEART_SWALLOWED_LINE,
  INCARNATED_LINE,
  INCARNATED_PARTS_LINE,
  IS_THIS_HER_LINE,
  PART_RESTORED_LINE,
  SERVANT_CAME_LINE,
  SOUL_WAITS_LINE,
  TEAR_OPENS_LINES,
} from "./kami/bossLines";
import {
  DEVOURED_ROOM_RESTARTS_LINE,
  FELL_OFF_PAGE_LINE,
  LAW_OUTSIDE_MODE_LINE,
  SUMIKUI_SEALED_LINE,
  SUMIKUI_SUMMONED_LINES,
} from "./kami/lines";
import type { NoteBook } from "./noteBook";
import {
  befallHerOnce,
  blob,
  bossPaceBody,
  COMMIT_WAIT_MS,
  cardLineOf,
  Eyes,
  line,
  Player,
  seen,
} from "./testing/player";

describe("Game in puzzle mode", () => {
  const spring = blob({ x: 680, y: 545 }, 35, 15);

  it("opens the first room with its card, the Sumikui loose without a note, and the room's laws only", async () => {
    const player = new Player(FIRST_PUZZLE_BOARD_ID, { mode: PUZZLE_MODE });
    await player.arrive();
    expect(player.hud.roomCard).toMatchObject({
      mode: "Puzzle",
      title: "The Wall",
      mark: `room 1 of ${PUZZLE_ROOMS.length}`,
    });
    expect(player.hud.cards).toEqual([]);
    expect(player.written).not.toContain(PUZZLE_MODE.card.opening);
    expect(player.written).not.toContain(cardLineOf(PUZZLE_MODE));
    expect(player.renderer.lastFrame?.world.sumikui).not.toBeNull();
    expect(player.laws.laws).toHaveLength(0);
    const opening = "Too tall to climb. She could fall up, if something threw her.";
    expect(player.written.filter((text) => text === opening)).toHaveLength(0);
    await player.wait(ROOM_CARD_SHOWN_MS - 100);
    expect(player.written.filter((text) => text === opening)).toHaveLength(0);
    await player.wait(ROOM_CARD_SHOWN_MS + 600);
    expect(player.written.filter((text) => text === opening)).toHaveLength(1);

    await player.write("we are on the moon", { x: 200, y: 200 });
    expect(player.written).toContain(LAW_OUTSIDE_MODE_LINE);
    expect(player.laws.laws).toHaveLength(0);

    await player.write("banish the ink eater", { x: 200, y: 300 });
    expect(player.laws.laws.map((law) => law.text)).toEqual(["banish the ink eater"]);
    expect(player.written).toContain(SUMIKUI_SEALED_LINE);
    expect(player.renderer.lastFrame?.world.sumikui).toBeNull();
  });

  it("names ink only as the room allows, and opens the next room after the closing line", async () => {
    const player = new Player(FIRST_PUZZLE_BOARD_ID, { mode: PUZZLE_MODE });
    await player.arrive();
    await player.draw(spring);
    await player.write("a ladder", { x: 640, y: 440 });
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["ink"]);
    await player.write("a trampoline", { x: 640, y: 400 });
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["bouncy"]);

    player.game.onAutopilotToggled(true);
    const [firstRoom, secondRoom] = PUZZLE_ROOMS;
    if (firstRoom === undefined || secondRoom === undefined) throw new Error("no rooms");
    expect(await player.until(() => player.written.includes(firstRoom.closing))).toBe(true);
    expect(await player.until(() => player.hud.roomCard?.title === "The Keyhole", 6_000)).toBe(
      true,
    );
    expect(player.hud.roomCard?.mark).toBe(`room 2 of ${PUZZLE_ROOMS.length}`);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.renderer.lastFrame?.world.sumikui).not.toBeNull();
  });

  it("offers the run's restart instead of the board menu, and it opens the first room", async () => {
    const [, secondRoom] = PUZZLE_ROOMS;
    if (secondRoom === undefined) throw new Error("no second room");
    const player = new Player(secondRoom.boardId, { mode: PUZZLE_MODE });
    await player.arrive();
    expect(player.hud.menu).toBe("run");
    expect(player.hud.roomCard?.mark).toBe(`room 2 of ${PUZZLE_ROOMS.length}`);

    player.game.onRestartRun();
    expect(await player.until(() => player.hud.roomCard?.title === "The Wall")).toBe(true);
    expect(player.hud.roomCard?.mark).toBe(`room 1 of ${PUZZLE_ROOMS.length}`);
  });

  it("keeps the board menu, and ignores a run restart, outside a staged run", async () => {
    const player = new Player("wonderland");
    await player.arrive();
    expect(player.hud.menu).toBe("boards");
    player.game.onRestartRun();
    await player.wait(200);
    expect(player.hud.roomCard).toBeNull();
  });

  it("stages the ledge on Earth until the moon is written", async () => {
    const ledge = new Player("puzzle-moon-ledge", { mode: PUZZLE_MODE });
    await ledge.arrive();
    await ledge.write("we are on the moon", { x: 200, y: 200 });
    expect(ledge.laws.laws.map((law) => law.text)).toEqual(["we are on the moon"]);
    expect(ledge.renderer.lastFrame?.world.sumikui).not.toBeNull();
  });

  it("shows a Solved card after the last room", async () => {
    const player = new Player("puzzle-moon-ledge", { mode: PUZZLE_MODE });
    await player.arrive();
    befallHerOnce(player.sim, [{ type: "goal-reached", who: 0 }]);
    await player.wait(50);
    expect(player.hud.cards.at(-1)).toMatchObject({
      title: "Solved",
      tagline: "Three rooms, all of them yours. Draw on, or play again.",
    });
  });

  it("shows a Lost card and restarts the room when the ink eater catches her", async () => {
    const player = new Player(FIRST_PUZZLE_BOARD_ID, { mode: PUZZLE_MODE });
    await player.arrive();
    await player.draw(blob({ x: 400, y: 530 }, 30, 20));
    await player.wait(COMMIT_WAIT_MS);
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);
    befallHerOnce(player.sim, [
      { type: "alice-devoured", who: 0 },
      { type: "fell", who: 0 },
    ]);
    expect(await player.until(() => player.written.includes(DEVOURED_ROOM_RESTARTS_LINE))).toBe(
      true,
    );
    expect(await player.until(() => player.hud.cards.at(-1)?.title === "Lost", 5_000)).toBe(true);
    expect(player.hud.cards.at(-1)).toMatchObject({
      title: "Lost",
      tagline: "The ink eater got her. Again, this room.",
    });
    expect(player.hud.roomCard?.title).toBe("The Wall");
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
  });

  it("puts her back at the checkpoint, room and ink intact, when she only falls", async () => {
    const player = new Player(FIRST_PUZZLE_BOARD_ID, { mode: PUZZLE_MODE });
    await player.arrive();
    await player.draw(blob({ x: 400, y: 530 }, 30, 20));
    await player.wait(COMMIT_WAIT_MS);
    const cardsBefore = player.hud.cards.length;
    befallHerOnce(player.sim, [{ type: "fell", who: 0 }]);
    await player.wait(5_000);
    expect(player.hud.cards).toHaveLength(cardsBefore);
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);
  });
});

describe("Game in the Sandbox", () => {
  const sandbox = (known: readonly string[] = ["bridge", "ladder", "rabbit", "cat"]) => {
    const eyes = new Eyes([], [], known);
    return { eyes, player: new Player("together", { mode: SANDBOX_MODE, eyes }) };
  };

  it("opens on an endless page with the mode's own opening line, and no rabbit hole to reach", async () => {
    const { player } = sandbox();
    await player.arrive();
    expect(player.written).not.toContain(SANDBOX_MODE.card.opening);
    expect(player.written).not.toContain(cardLineOf(SANDBOX_MODE));
    expect(player.renderer.board?.page).toBe("endless");
    expect(player.renderer.board?.goal).toBeUndefined();
  });

  it("quietly drops ink beneath the endless page ground", async () => {
    const { player } = sandbox();
    await player.arrive();
    await player.draw(line({ x: 100, y: 100 }, { x: 220, y: 100 }));
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);

    await player.draw(line({ x: 100, y: -40 }, { x: 220, y: -40 }));
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);
  });

  it("keeps Kami's reply to a name clear of the ground and Alice", async () => {
    const { player } = sandbox(["dog"]);
    await player.arrive();
    const centre = player.alice.center;
    await player.draw(ringAround({ x: centre.x - 70, y: centre.y }, 25));
    await player.write("a dog", { x: centre.x - 30, y: centre.y });
    await player.wait(500);

    const notebook = (player.game as unknown as { notes: NoteBook }).notes;
    const notes = (player.renderer.lastFrame?.notes ?? []).filter((note) =>
      notebook.fleetingBy("kami").some(({ id }) => id === note.id),
    );
    const alice = player.sim.aliceBounds(0);
    const viewport = player.renderer.viewport();
    const visible = { x: 0, y: 0, width: viewport.width, height: viewport.height };
    for (const note of notes) {
      expect(rectsOverlap(note.script.bounds, ENDLESS_GROUND)).toBe(false);
      expect(rectsOverlap(note.script.bounds, alice)).toBe(false);
      expect(note.script.bounds.x).toBeGreaterThanOrEqual(visible.x);
      expect(note.script.bounds.y).toBeGreaterThanOrEqual(visible.y);
      expect(note.script.bounds.x + note.script.bounds.width).toBeLessThanOrEqual(
        visible.x + visible.width,
      );
      expect(note.script.bounds.y + note.script.bounds.height).toBeLessThanOrEqual(
        visible.y + visible.height,
      );
    }
  });

  it("says when Alice falls off the endless page", async () => {
    const { player } = sandbox();
    await player.arrive();
    player.game.onAutopilotToggled(false);
    player.walk(1);
    expect(await player.until(() => player.written.includes(FELL_OFF_PAGE_LINE), 10_000)).toBe(
      true,
    );
  });

  it("tells the player the page ends where the ground does, when asked for help at the edge", async () => {
    const { player, eyes } = sandbox();
    await player.arrive();
    await player.write("help", { x: 60, y: -160 });
    expect(player.written).toContain(DROP_LINE);
    expect(eyes.summoned).toEqual([]);
  });

  it("answers the CAT button with the same counsel as writing *help*", async () => {
    const { player, eyes } = sandbox();
    await player.arrive();
    player.hud.handlers.onAskForHint();
    await player.wait(100);
    expect(player.written).toContain(DROP_LINE);
    expect(eyes.summoned).toEqual([]);
  });

  it("does not repeat the same counsel while the first line is still visible", async () => {
    const { player } = sandbox();
    await player.arrive();
    await player.write("help", { x: 60, y: -160 });
    await player.write("give me an idea", { x: 60, y: -160 });

    expect(player.written.filter((text) => text === DROP_LINE)).toHaveLength(1);
  });

  it("starts a bridge across a gap when asked how to get across", async () => {
    const { player, eyes } = sandbox();
    await player.arrive();
    await player.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await player.write("ground", { x: 760, y: -120 });
    await player.write("how do I get across?", { x: 60, y: -160 });
    expect(player.written).toContain(BRIDGE_LINE);
    expect(eyes.summoned).toEqual(["bridge"]);
    await player.wait(2_000);
    const bridge = player.renderer.lastFrame?.inks.at(-1);
    expect(bridge).toBeDefined();
    const span =
      bridge === undefined
        ? null
        : boundsOf(bridge.drawing.strokes.flat().map((point) => poseToWorld(point, bridge.pose)));
    expect(span?.x).toBeLessThan(ENDLESS_GROUND.x + ENDLESS_GROUND.width);
    expect((span?.x ?? 0) + (span?.width ?? 0)).toBeGreaterThan(620);
  });

  it("leans a ladder against a wall too tall to jump", async () => {
    const { player, eyes } = sandbox();
    await player.arrive();
    await player.scrawl([
      line({ x: 200, y: 0 }, { x: 200, y: -320 }),
      line({ x: 200, y: -320 }, { x: 260, y: -320 }),
      line({ x: 260, y: -320 }, { x: 260, y: 0 }),
    ]);
    await player.write("wall", { x: 300, y: -400 });
    await player.write("what can I do?", { x: 60, y: -160 });
    expect(player.written).toContain(LADDER_LINE);
    expect(eyes.summoned).toEqual(["ladder"]);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toContain("climbable");
  });

  it("sketches a friend beside her on an open stretch, when asked for an idea", async () => {
    const { player, eyes } = sandbox();
    await player.arrive();
    await player.draw(line({ x: -1500, y: 20 }, { x: 1500, y: 20 }));
    await player.write("ground", { x: 1000, y: -120 });
    await player.write("give me an idea", { x: 60, y: -160 });
    expect(player.written).toContain(IDEAS[0]?.line);
    expect(eyes.summoned).toEqual(["rabbit"]);
    await player.wait(2_000);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.nature)).toEqual(["solid", "hopper"]);
  });

  it("offers ideas in turn when there is nothing to draw them with", async () => {
    const { player, eyes } = sandbox([]);
    await player.arrive();
    await player.draw(line({ x: -1500, y: 20 }, { x: 1500, y: 20 }));
    await player.write("ground", { x: 1000, y: -120 });
    await player.write("give me an idea", { x: 60, y: -160 });
    expect(player.written).toContain(IDEAS[0]?.line);
    await player.write("any ideas?", { x: 60, y: -260 });
    expect(player.written).toContain(IDEAS[1]?.line);
    expect(eyes.summoned).toEqual(["rabbit"]);
  });

  it("leaves words alone without the server's pictures", async () => {
    const { player, eyes } = sandbox([]);
    await player.arrive();
    await player.draw(line({ x: 620, y: 0 }, { x: 900, y: 0 }));
    await player.write("ground", { x: 760, y: -120 });
    const before = player.renderer.lastFrame?.inks.length ?? 0;
    await player.write("help", { x: 60, y: -160 });
    expect(player.written).toContain(BRIDGE_LINE);
    expect(eyes.summoned).toEqual(["bridge"]);
    expect(player.renderer.lastFrame?.inks).toHaveLength(before);
  });

  it("never offers help unasked, however long she idles, while a room still does", async () => {
    const { player } = sandbox();
    await player.arrive();
    await player.wait(50_000);
    expect(player.written.some((text) => text.includes(OFFER_HELP))).toBe(false);

    const roomed = new Player("wonderland");
    await roomed.arrive();
    await roomed.wait(50_000);
    expect(roomed.written.some((text) => text.includes(OFFER_HELP))).toBe(true);
  });

  it("has nothing hungry on the page: the ink eater is refused in lore", async () => {
    const { player } = sandbox();
    await player.arrive();
    await player.write("summon the ink eater", { x: 200, y: -200 });
    expect(player.written).toContain(NOTHING_HUNGRY_LINE);
    expect(player.written).not.toContain(SUMIKUI_SUMMONED_LINES[0]);
    expect(player.renderer.lastFrame?.world.sumikui ?? null).toBeNull();
    expect(player.laws.laws).toHaveLength(0);
  });

  it("puts her back on the last ink she stood on when she walks off it", async () => {
    const { player } = sandbox();
    await player.arrive();
    player.walk(1);
    expect(await player.until(() => player.written.includes(FELL_OFF_PAGE_LINE), 20_000)).toBe(
      true,
    );
    player.walk(0);
    expect(player.alice.center.y).toBeLessThan(0);
    expect(player.alice.center.x).toBeLessThan(ENDLESS_GROUND.x + ENDLESS_GROUND.width);
    expect(player.alice.center.x).toBeGreaterThan(0);
  });
});

describe("Game in Boss mode", () => {
  const soulOf = (player: Player): Vec => {
    const soul = player.renderer.lastFrame?.world.soul;
    if (soul === undefined) throw new Error("Nothing has been rendered yet");
    if (soul === null) throw new Error("Somebody is on the board");
    return soul.at;
  };

  const drawnLook = (player: Player) => {
    const { look } = player.alice;
    if (look.kind !== "drawn") throw new Error("She wears Kami's own sketch");
    return look;
  };

  const tearOf = (player: Player) => player.renderer.lastFrame?.world.tear ?? null;

  let player: Player;

  beforeEach(async () => {
    player = new Player("wonderland", { mode: BOSS_MODE });
    await player.arrive();
  });

  it("opens as a soul, tells both players their part, and will not walk her by herself", async () => {
    expect(player.renderer.lastFrame?.world.alice).toBeNull();
    expect(soulOf(player).x).toBeCloseTo(
      BOSS_MODE.page === "arena" ? 0 : boardFor("wonderland").spawn.x,
      0,
    );
    expect(player.written).not.toContain(SOUL_WAITS_LINE);
    expect(player.written).not.toContain(BOSS_MODE.card.opening);
    expect(player.written).not.toContain("She can hop, not fly. You can draw.");
    for (const role of BOSS_MODE.card.roles ?? []) expect(player.written).not.toContain(role);
    expect(player.hud.cards).toEqual([BOSS_MODE.card]);
    await player.wait(titleCardShownMs(BOSS_MODE.card) + 600);
    expect(player.written).toContain(SOUL_WAITS_LINE);
    player.game.onAutopilotToggled(true);
    expect(player.hud.autopilot).toBe(false);
    player.walk(1);
    await player.wait(500);
    expect(player.renderer.lastFrame?.world.alice).toBeNull();
  });

  it("keeps the soul when the arena is rebuilt on resize", async () => {
    expect(soulOf(player)).toBeDefined();
    player.game.onResize();
    expect(soulOf(player)).toBeDefined();
    expect(player.renderer.lastFrame?.world.alice).toBeNull();
  });

  it("clears player ink and laws while keeping the Boss soul", async () => {
    const heart = soulOf(player);
    player.game.onCommit(drawingOf("old ink", ringAround({ x: heart.x + 80, y: heart.y }, 20)));
    await player.write("gravity is weaker", { x: heart.x + 200, y: heart.y + 100 });
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);
    expect(player.laws.laws).toHaveLength(1);

    player.game.onClearBoard();
    await player.wait(100);

    expect(soulOf(player)).toEqual(expect.objectContaining({ x: heart.x, y: heart.y }));
    expect(player.renderer.lastFrame?.world.tear).toBeNull();
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.laws.laws).toHaveLength(0);
  });

  it("drops ink below the arena floor but accepts ink beside it", async () => {
    await player.draw(line({ x: 100, y: 40 }, { x: 180, y: 40 }));
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);

    await player.draw(line({ x: 100, y: -40 }, { x: 180, y: -40 }));
    expect(player.renderer.lastFrame?.inks).toHaveLength(1);

    await player.write("gravity is weaker", { x: 100, y: 40 });
    expect(player.laws.laws).toHaveLength(0);
    expect(player.written).not.toContain("gravity is weaker");
  });

  it("opens every Boss fight on a fresh page", async () => {
    const drawing = drawingOf("old-fight", ringAround(soulOf(player), 30));
    player.game.onCommit(drawing);
    await player.wait(100);
    expect((await player.store.load("wonderland")).drawings).toHaveLength(1);

    player.game.onOpenBoard("wonderland");
    await player.wait(100);

    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect((await player.store.load("wonderland")).drawings).toHaveLength(0);
  });

  it("makes the drawing her body when it is named, and tears the page open above her", async () => {
    const heart = soulOf(player);
    const body = drawingOf("body", ...figureAround(heart));
    player.game.onCommit(body);
    await player.wait(50);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.drawing.id)).toEqual([body.id]);

    await player.write("me", { x: heart.x, y: heart.y + 45 });
    expect(player.renderer.lastFrame?.world.soul).toBeNull();
    expect(drawnLook(player).body.strokes).toHaveLength(6);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.written).toContain(INCARNATED_LINE("me"));
    expect(tearOf(player)?.phase).toBe("opening");
    expect((await player.store.load("wonderland")).drawings).toHaveLength(0);

    expect(await player.until(() => (tearOf(player)?.snippers.length ?? 0) > 0)).toBe(true);
    expect(player.written).toContain(TEAR_OPENS_LINES[0]);
    expect(player.written).toContain(SERVANT_CAME_LINE);
  });

  it("names a body from anywhere on the page when the player is still a soul", async () => {
    const heart = soulOf(player);
    player.game.onCommit(drawingOf("body", ringAround(heart, 30)));
    await player.wait(50);
    await player.write("alice", { x: heart.x + 200, y: heart.y + 100 });
    expect(player.renderer.lastFrame?.world.soul).toBeNull();
    expect(drawnLook(player).body.strokes).toHaveLength(1);
  });

  it("makes a body drawn as several drawings one body when named", async () => {
    const heart = soulOf(player);
    const far = drawingOf("far", ringAround({ x: heart.x + 300, y: heart.y }, 20));
    player.game.onCommit(far);
    await player.wait(50);
    for (const stroke of bossPaceBody(heart)) await player.draw(stroke);

    await player.write("alice", { x: heart.x + 200, y: heart.y + 100 });

    expect(player.sim.snapshot().alice?.look.kind).toBe("drawn");
    const look = drawnLook(player);
    expect(look.abilities.see).toBe(true);
    expect(look.abilities.walk).toBe(true);
    expect(look.abilities.climb).toBe(true);
    expect(player.renderer.lastFrame?.inks.map((ink) => ink.drawing.id)).toEqual([far.id]);
  });

  it("offers Alice instead of scenery guesses for the body nearest the soul", async () => {
    const eyes = new Eyes([], [seen("mushroom", "ink"), seen("cake", "ink")]);
    const player = new Player("wonderland", { eyes, mode: BOSS_MODE });
    await player.arrive();
    const heart = soulOf(player);
    player.game.onCommit(drawingOf("body", ringAround(heart, 30)));
    await player.wait(100);

    const guesses = player.renderer.lastFrame?.notes.filter((note) => note.tappable) ?? [];
    expect(guesses.map((note) => note.script.text)).toEqual(["Alice?"]);
    expect(player.written).toContain(IS_THIS_HER_LINE);

    const first = guesses[0];
    if (first === undefined) throw new Error("no Alice guess to tap");
    const { x, y, width, height } = first.script.bounds;
    player.game.tap({ x: x + width / 2, y: y + height / 2 });
    await player.wait(100);

    expect(player.renderer.lastFrame?.world.soul).toBeNull();
    expect(drawnLook(player).body.strokes).toHaveLength(1);
  });

  it("keeps normal scenery guesses for drawings far from the soul", async () => {
    const eyes = new Eyes([], [seen("mushroom", "ink"), seen("cake", "ink")]);
    const player = new Player("wonderland", { eyes, mode: BOSS_MODE });
    await player.arrive();
    const soul = soulOf(player);
    player.game.onCommit(drawingOf("far", ringAround({ x: soul.x + 300, y: soul.y }, 20)));
    await player.wait(100);

    const guesses = player.renderer.lastFrame?.notes.filter((note) => note.tappable) ?? [];
    expect(guesses.map((note) => note.script.text)).toEqual([
      "a mushroom?",
      "a cake?",
      "a balloon?",
    ]);
  });

  it("never sends her body to be tidied: not when named, nor when the slider comes to rest", async () => {
    const eyes = new Eyes([], []);
    const twoPlayers = new Player("wonderland", { eyes, mode: BOSS_MODE });
    await twoPlayers.arrive();
    const heart = soulOf(twoPlayers);
    twoPlayers.game.onCommit(drawingOf("body", ...figureAround(heart)));
    await twoPlayers.write("me", { x: heart.x, y: heart.y + 45 });
    expect(drawnLook(twoPlayers).body.strokes).toHaveLength(6);
    await twoPlayers.scrawl(legsBelow(heart).map((stroke) => [...stroke]));

    twoPlayers.hud.handlers.onTidinessChanged(1);
    await twoPlayers.wait(600);
    expect(eyes.tidiedAs).toEqual([]);
    expect(drawnLook(twoPlayers).body.strokes).toHaveLength(8);
  });

  it("grafts legs drawn onto a legless body, and says so", async () => {
    const heart = soulOf(player);
    const legless = figureAround(heart)
      .slice(0, 4)
      .map((stroke, index) =>
        index < 2 ? stroke : stroke.map((point) => ({ ...point, y: point.y - 10 })),
      );
    player.game.onCommit(drawingOf("body", ...legless));
    await player.write("alice", { x: heart.x, y: heart.y + 15 });
    expect(drawnLook(player).abilities.walk).toBe(false);
    expect(player.written).toContain(INCARNATED_PARTS_LINE(["head", "arms"]));

    await player.wait(500);
    const current = player.alice;
    if (current.look.kind !== "drawn") throw new Error("drawing did not incarnate");
    const bodyHeart = {
      x: current.center.x + current.look.body.heart.x * current.look.scale,
      y: current.center.y + current.look.body.heart.y * current.look.scale,
    };
    const legs = legsBelow(bodyHeart).map((stroke) =>
      stroke.map((point) => ({
        ...point,
        y: bodyHeart.y + (point.y - bodyHeart.y) * 0.6,
      })),
    );
    await player.scrawl(legs.map((stroke) => [...stroke]));
    expect(drawnLook(player).abilities.walk).toBe(true);
    expect(drawnLook(player).body.strokes).toHaveLength(6);
    expect(player.renderer.lastFrame?.inks).toHaveLength(0);
    expect(player.written).toContain(PART_RESTORED_LINE(["legs"]));
  });

  it("opens the room again once the heart is swallowed", async () => {
    const heart = soulOf(player);
    player.game.onCommit(drawingOf("body", ringAround(heart, 14)));
    await player.write("her", { x: heart.x, y: heart.y + 15 });
    expect(player.renderer.lastFrame?.world.alice).not.toBeNull();

    expect(await player.until(() => player.written.includes(HEART_SWALLOWED_LINE))).toBe(true);
    expect(player.renderer.lastFrame?.world.alice).toBeNull();
    expect(tearOf(player)).toBeNull();

    expect(
      await player.until(
        () =>
          player.written.includes(SOUL_WAITS_LINE) &&
          !player.written.includes(HEART_SWALLOWED_LINE),
        20_000,
      ),
    ).toBe(true);
    expect(soulOf(player).x).toBeCloseTo(heart.x, 0);
    expect(player.hud.cards.at(-1)).toMatchObject({
      title: "Again",
      tagline:
        "It took the heart. Draw her a body around it and write who she is — faster this time.",
    });
  });

  it("shows the Boss win card when the tear closes", async () => {
    befallHerOnce(player.sim, [{ type: "tear-closed" }]);
    await player.wait(50);
    expect(player.hud.cards.at(-1)).toMatchObject({
      title: "The tear is closed",
      tagline: "It went back under the page. She is whole enough. Draw on, or start again.",
    });
  });
});

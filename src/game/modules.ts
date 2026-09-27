import type { BoardDefinition } from "../board/types";
import type { Cat } from "../cat/types";
import type { Vec } from "../core/geometry";
import type { Handwriting } from "../handwriting/types";
import type { DrawingId, InkSession, InkSessionListener, PosedDrawing } from "../ink/types";
import type { GameMode } from "../modes/types";
import type { BoardStore } from "../persistence/types";
import type { PenReader } from "../reading/types";
import type { LiveRecognizer } from "../recognition/types";
import type { Renderer } from "../render/types";
import type { Rule, RuleCompiler, SceneCompiler, WorldPhysics } from "../rules/types";
import type { Simulation } from "../sim/types";
import type { Summoner } from "../summoning";
import type { BoardLink } from "../sync";
import type { Hud, HudHandlers, LawsPanel, LawsPanelHandlers } from "../ui/types";
import type { Hire } from "./party";

/** Everything a `Game` is wired to. An optional module left out switches its feature off. */
export interface GameModules {
  readonly sim: Simulation;
  readonly autopilot: Hire;
  readonly cat: Cat;
  readonly renderer: Renderer;
  readonly handwriting: Handwriting;
  /** The offline grammar: instant, so it is asked first. */
  readonly compiler: RuleCompiler;
  /** A model behind the server: may take seconds, so it is asked last. */
  readonly thinker: RuleCompiler;
  readonly store: BoardStore;
  readonly penReader?: PenReader;
  /** Tidies a drawing once it has a name. */
  readonly finisher?: Pick<LiveRecognizer, "complete">;
  /** Pictures Kami can draw himself; without one he asks the player to draw them. */
  readonly summoner?: Summoner;
  readonly scenes?: SceneCompiler;
  /** Folds standing rules over `base`: EARTH, or the world a staged room lays down. */
  readonly resolvePhysics: (rules: readonly Rule[], base?: WorldPhysics) => WorldPhysics;
  readonly boardFor: (id: string) => BoardDefinition;
  /** The page an endless mode opens under an id; the sandbox's wide floor by default. */
  readonly endlessPageFor?: (id: string) => BoardDefinition;
  readonly createInkSession: (listener: InkSessionListener) => InkSession;
  readonly createHud: (handlers: HudHandlers) => Hud;
  readonly createLawsPanel: (handlers: LawsPanelHandlers) => LawsPanel;
  readonly findDrawingAt: (
    point: Vec,
    drawings: readonly PosedDrawing[],
    tolerance: number,
  ) => DrawingId | null;
  readonly onBoardOpened?: (boardId: string) => void;
  /** The line to shared pages, used by `sharing: "live"` modes. */
  readonly link?: BoardLink | null;
  readonly shareLinkFor?: (boardId: string) => string;
  /** `EMBODIED_MODE` by default. */
  readonly mode?: GameMode;
  readonly selfDriving?: boolean;
  readonly onSelfDrivingChanged?: (enabled: boolean) => void;
  /** How firmly Kami tidies a named drawing: 0 not at all, 1 as firm as he gets. */
  readonly tidiness?: number;
  readonly onTidinessChanged?: (tidiness: number) => void;
}

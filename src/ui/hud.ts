import { CatBubble } from "./catBubble";
import { type CatVoice, createCatVoice } from "./catVoice";
import { el } from "./dom";
import { EndingView } from "./ending";
import { KeyboardWalk } from "./keyboard";
import { trackKeyboardInset } from "./keyboardInset";
import { NamingPanel } from "./namingPanel";
import { Scrawl } from "./scrawl";
import { SpellPanel } from "./spellPanel";
import { TitleCardView } from "./titleCard";
import { TopBar } from "./topBar";
import { installTouchGuards } from "./touchGuards";
import type { Detach, EndingEntry, Hud, HudHandlers, TitleCard } from "./types";
import { WalkIntentMerger } from "./walkIntent";

export class DomHud implements Hud {
  private readonly overlay = el("div", { className: "kami-hud" });
  private readonly topBar: TopBar;
  private readonly naming: NamingPanel;
  private readonly spell: SpellPanel;
  private readonly scrawlLine = new Scrawl();
  private readonly cat = new CatBubble();
  private readonly titleCard = new TitleCardView();
  private readonly ending = new EndingView();
  private readonly voice: CatVoice;
  private readonly detachers: readonly Detach[];

  constructor(root: HTMLElement, handlers: HudHandlers) {
    const host = root.ownerDocument.defaultView ?? window;
    const walk = new WalkIntentMerger((intent) => handlers.onWalkIntent(intent));
    this.voice = createCatVoice(host);
    this.naming = new NamingPanel(handlers);
    this.spell = new SpellPanel(handlers);
    this.topBar = new TopBar({
      onEraserToggled: (active) => handlers.onEraserToggled(active),
      onResetRoom: () => handlers.onResetRoom(),
      onAskCat: () => handlers.onAskCat(),
      onSpellToggled: () => this.spell.toggle(),
      onMuteToggled: (muted) => this.voice.setMuted(muted),
    });
    this.overlay.append(
      this.topBar.element,
      this.cat.element,
      this.scrawlLine.element,
      this.naming.element,
      this.spell.element,
      this.titleCard.element,
      this.ending.element,
    );
    root.append(this.overlay);
    this.detachers = [
      new KeyboardWalk(walk.source()).attach(host),
      installTouchGuards(root.ownerDocument),
      trackKeyboardInset(host, this.overlay),
    ];
  }

  get namingOpen(): boolean {
    return this.naming.open;
  }

  setRoom(title: string, index: number, count: number): void {
    this.topBar.setRoom(title, index, count);
  }

  setInk(budget: { readonly total: number; readonly remaining: number }): void {
    this.topBar.inkMeter.set(budget);
  }

  showNaming(guesses: readonly string[]): void {
    this.spell.hide();
    this.naming.show(guesses);
  }

  hideNaming(): void {
    this.naming.hide();
  }

  say(line: string): void {
    this.cat.say(line);
    this.voice.speak(line);
  }

  setEraserActive(active: boolean): void {
    this.topBar.setEraserActive(active);
  }

  scrawl(text: string): void {
    this.scrawlLine.write(text);
  }

  showTitleCard(card: TitleCard): Promise<void> {
    return this.titleCard.show(card);
  }

  showEnding(entries: readonly EndingEntry[], onRestart: () => void): void {
    this.naming.hide();
    this.spell.hide();
    this.ending.show(entries, onRestart);
  }

  hideEnding(): void {
    this.ending.hide();
  }

  dispose(): void {
    for (const detach of this.detachers) detach();
    this.ending.hide();
    this.overlay.remove();
  }
}

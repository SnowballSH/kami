/** Hands out each list of lines in turn, round and round, so Kami never says the same one twice running. */
export class LineCycles {
  private readonly said = new Map<readonly string[], number>();

  next(lines: readonly string[]): string {
    const count = this.said.get(lines) ?? 0;
    this.said.set(lines, count + 1);
    return lines[count % lines.length] ?? "";
  }
}

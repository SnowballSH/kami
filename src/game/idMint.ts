/** Branded ids without `crypto.randomUUID`, which plain-HTTP LAN origins (the iPad) do not have. */
export class IdMint {
  private count = 0;

  next<Id extends string>(prefix: string): Id {
    this.count += 1;
    const entropy = Math.floor(Math.random() * 36 ** 4).toString(36);
    return `${prefix}-${Date.now().toString(36)}-${this.count.toString(36)}-${entropy}` as Id;
  }
}

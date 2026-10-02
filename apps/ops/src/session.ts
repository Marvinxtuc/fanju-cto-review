export interface SessionSnapshot { readonly token: string; readonly generation: number }

/** A request captures this at render/start; it cannot publish results into a later session. */
export class SessionTracker {
  private token = "";
  private generation = 0;
  capture(): SessionSnapshot { return { token: this.token, generation: this.generation }; }
  invalidate(): number { this.token = ""; return ++this.generation; }
  activate(token: string): void { this.token = token; this.generation++; }
  isGeneration(generation: number): boolean { return generation === this.generation; }
  isCurrent(snapshot: SessionSnapshot): boolean {
    return Boolean(snapshot.token) && snapshot.token === this.token && this.isGeneration(snapshot.generation);
  }
}

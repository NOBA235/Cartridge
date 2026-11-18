/**
 * The live loop: on every scene change, wait until drawing pauses (600 ms),
 * then check only connections whose text is new, one at a time. Results are
 * cached by text (per cartridge version), so moving a box or reopening the
 * canvas does not ask the device again. A newer change cancels the run in
 * progress: the connection being checked finishes and is cached, the rest of
 * the old list is dropped.
 */
import type { Private } from '@/privacy';
import { reveal } from '@/privacy';
import type { EdgeVerdict } from './evaluate';
import type { DiagramEdge } from './scene';

export const DEBOUNCE_MS = 600;

export interface CheckerOptions {
  evaluate: (text: Private<string>) => Promise<EdgeVerdict>;
  /** Called whenever a new result is known. */
  onResult: () => void;
  debounceMs?: number;
}

export class EdgeChecker {
  private readonly cache = new Map<string, EdgeVerdict>();
  private readonly options: CheckerOptions;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private run = 0;
  private pending: DiagramEdge[] = [];
  private busy = false;
  private stopped = false;

  constructor(options: CheckerOptions) {
    this.options = options;
  }

  /** The cached result for this connection text, if checked. */
  get(text: Private<string>): EdgeVerdict | undefined {
    return this.cache.get(reveal(text));
  }

  /** True while connections are waiting or being checked. */
  get checking(): boolean {
    return this.busy || this.timer !== undefined;
  }

  /** The diagram changed: check its connections after a pause. */
  schedule(edges: readonly DiagramEdge[]): void {
    if (this.stopped) return;
    this.run++;
    this.pending = [...edges];
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain(this.run);
    }, this.options.debounceMs ?? DEBOUNCE_MS);
  }

  stop(): void {
    this.stopped = true;
    this.run++;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async drain(run: number): Promise<void> {
    if (this.busy) return; // the run in progress picks up the newest list when it ends
    this.busy = true;
    try {
      while (!this.stopped) {
        const current = this.run;
        const next = this.pending.find((e) => !this.cache.has(reveal(e.text)));
        if (!next) break;
        const text = reveal(next.text);
        const verdict = await this.options.evaluate(next.text);
        this.cache.set(text, verdict);
        if (!this.stopped) this.options.onResult();
        // A newer change waits for its own pause before checking anything.
        if (this.run !== current && this.timer !== undefined) break;
      }
    } finally {
      this.busy = false;
    }
    // A change arrived during the last check and its pause has already ended.
    if (!this.stopped && this.run !== run && this.timer === undefined) void this.drain(this.run);
  }
}

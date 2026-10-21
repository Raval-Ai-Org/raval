/** Serialize each post's edits and retain failed batches beneath newer edits. */
export class AutosaveQueue<Patch extends object> {
  private pending = new Map<string, Patch>();
  private saving = new Map<string, Patch>();
  private inFlight = new Map<string, Promise<void>>();
  private revision = 0;

  get version(): number {
    return this.revision;
  }

  enqueue(id: string, patch: Patch): void {
    this.pending.set(id, { ...this.pending.get(id), ...patch });
    this.revision++;
  }

  peek(id: string): Partial<Patch> {
    return { ...this.saving.get(id), ...this.pending.get(id) };
  }

  pendingIds(): string[] {
    return [...this.pending.keys()];
  }

  async flush(id: string, save: (patch: Patch) => Promise<unknown>): Promise<void> {
    const active = this.inFlight.get(id);
    if (active) {
      await active;
      return this.flush(id, save);
    }
    const patch = this.pending.get(id);
    if (!patch) return;
    this.pending.delete(id);
    this.saving.set(id, patch);
    const operation = Promise.resolve()
      .then(() => save(patch))
      .then(() => {
        this.revision++;
      })
      .catch((error) => {
        this.pending.set(id, { ...patch, ...this.pending.get(id) });
        this.revision++;
        throw error;
      })
      .finally(() => {
        this.saving.delete(id);
        this.inFlight.delete(id);
      });
    this.inFlight.set(id, operation);
    await operation;
    // Approval, scheduling and rewriting must also wait for edits made mid-save.
    return this.flush(id, save);
  }

  async discard(id: string): Promise<void> {
    this.pending.delete(id);
    await this.inFlight.get(id)?.catch(() => undefined);
    this.pending.delete(id);
    this.revision++;
  }
}

export interface PiBackendOptions {
  readonly sessionDir?: string;
}

export class PiBackend {
  public readonly sessionDir: string | undefined;

  constructor(options: PiBackendOptions = {}) {
    this.sessionDir = options.sessionDir;
  }

  isAlive(): boolean {
    return true;
  }
}

export function createPiBackend(options: PiBackendOptions = {}): PiBackend {
  return new PiBackend(options);
}

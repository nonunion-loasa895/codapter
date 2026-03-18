import { randomUUID } from "node:crypto";
import type {
  BackendCapabilities,
  BackendEvent,
  BackendImageInput,
  BackendMessage,
  BackendModelSummary,
  Disposable,
  IBackend,
} from "@codapter/core";

export interface PiBackendOptions {
  readonly sessionDir?: string;
  readonly models?: readonly BackendModelSummary[];
  readonly capabilities?: Partial<BackendCapabilities>;
}

interface PiSessionState {
  readonly sessionId: string;
  readonly createdAt: string;
  updatedAt: string;
  name: string | null;
  modelId: string | null;
  disposed: boolean;
  messages: BackendMessage[];
  listeners: Set<(event: BackendEvent) => void>;
}

const DEFAULT_MODELS: readonly BackendModelSummary[] = [
  {
    id: "pi-default",
    model: "pi-default",
    displayName: "Pi Default",
    description: "Default Pi backend placeholder model.",
    hidden: false,
    isDefault: true,
    inputModalities: ["text"],
    supportedReasoningEfforts: ["minimal", "medium"],
    defaultReasoningEffort: "medium",
    supportsPersonality: false,
  },
  {
    id: "pi-fast",
    model: "pi-fast",
    displayName: "Pi Fast",
    description: "Low-latency Pi backend placeholder model.",
    hidden: false,
    isDefault: false,
    inputModalities: ["text"],
    supportedReasoningEfforts: ["minimal"],
    defaultReasoningEffort: "minimal",
    supportsPersonality: false,
  },
];

const DEFAULT_CAPABILITIES: BackendCapabilities = {
  requiresAuth: false,
  supportsImages: false,
  supportsThinking: true,
  supportsParallelTools: false,
  supportedToolTypes: [],
};

function nowIso(): string {
  return new Date().toISOString();
}

function cloneMessage(message: BackendMessage): BackendMessage {
  return {
    ...message,
    content: structuredClone(message.content),
  };
}

function cloneMessages(messages: readonly BackendMessage[]): BackendMessage[] {
  return messages.map(cloneMessage);
}

function cloneModels(models: readonly BackendModelSummary[]): BackendModelSummary[] {
  return models.map((model) => ({
    ...model,
    inputModalities: [...model.inputModalities],
    supportedReasoningEfforts: [...model.supportedReasoningEfforts],
  }));
}

function cloneCapabilities(capabilities: BackendCapabilities): BackendCapabilities {
  return {
    ...capabilities,
    supportedToolTypes: [...capabilities.supportedToolTypes],
  };
}

function unsupportedOperation(operation: string): Error {
  return new Error(`Pi backend scaffold does not implement ${operation} yet`);
}

export class PiBackend implements IBackend {
  public readonly sessionDir: string | undefined;

  private readonly models: BackendModelSummary[];
  private readonly capabilities: BackendCapabilities;
  private readonly sessions = new Map<string, PiSessionState>();
  private initialized = false;
  private disposed = false;
  private sessionCounter = 0;
  private messageCounter = 0;

  constructor(options: PiBackendOptions = {}) {
    this.sessionDir = options.sessionDir;
    this.models = cloneModels(options.models ?? DEFAULT_MODELS);
    this.capabilities = cloneCapabilities({
      ...DEFAULT_CAPABILITIES,
      ...options.capabilities,
      supportedToolTypes:
        options.capabilities?.supportedToolTypes ?? DEFAULT_CAPABILITIES.supportedToolTypes,
    });
  }

  async initialize(): Promise<void> {
    this.assertNotDisposed();
    this.initialized = true;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.sessions.clear();
  }

  isAlive(): boolean {
    return this.initialized && !this.disposed;
  }

  async createSession(): Promise<string> {
    this.assertReady();
    const sessionId = this.allocateSessionId();
    this.sessions.set(sessionId, this.createSessionState(sessionId));
    return sessionId;
  }

  async resumeSession(sessionId: string): Promise<string> {
    this.assertReady();
    this.getSessionOrThrow(sessionId);
    return sessionId;
  }

  async forkSession(sessionId: string): Promise<string> {
    this.assertReady();
    const source = this.getSessionOrThrow(sessionId);
    const forkedSessionId = this.allocateSessionId();
    this.sessions.set(forkedSessionId, {
      sessionId: forkedSessionId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      name: source.name,
      modelId: source.modelId,
      disposed: false,
      messages: cloneMessages(source.messages),
      listeners: new Set(),
    });
    return forkedSessionId;
  }

  async disposeSession(sessionId: string): Promise<void> {
    this.assertReady();
    const session = this.getSessionOrThrow(sessionId);
    session.disposed = true;
    session.listeners.clear();
    this.sessions.delete(sessionId);
  }

  async readSessionHistory(sessionId: string): Promise<BackendMessage[]> {
    this.assertReady();
    return cloneMessages(this.getSessionOrThrow(sessionId).messages);
  }

  async setSessionName(sessionId: string, name: string): Promise<void> {
    this.assertReady();
    const session = this.getSessionOrThrow(sessionId);
    session.name = name;
    session.updatedAt = nowIso();
  }

  async prompt(
    sessionId: string,
    turnId: string,
    text: string,
    images?: readonly BackendImageInput[]
  ): Promise<void> {
    this.assertReady();
    this.getSessionOrThrow(sessionId);
    void turnId;
    void text;
    void images;
    throw unsupportedOperation("prompt");
  }

  async abort(sessionId: string): Promise<void> {
    this.assertReady();
    this.getSessionOrThrow(sessionId);
    throw unsupportedOperation("abort");
  }

  async listModels(): Promise<BackendModelSummary[]> {
    this.assertReady();
    return cloneModels(this.models);
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    this.assertReady();
    const session = this.getSessionOrThrow(sessionId);
    this.ensureModelExists(modelId);
    session.modelId = modelId;
    session.updatedAt = nowIso();
  }

  async getCapabilities(): Promise<BackendCapabilities> {
    this.assertReady();
    return cloneCapabilities(this.capabilities);
  }

  async respondToElicitation(
    sessionId: string,
    requestId: string,
    response: unknown
  ): Promise<void> {
    this.assertReady();
    this.getSessionOrThrow(sessionId);
    void requestId;
    void response;
    throw unsupportedOperation("respondToElicitation");
  }

  onEvent(sessionId: string, listener: (event: BackendEvent) => void): Disposable {
    this.assertReady();
    const session = this.getSessionOrThrow(sessionId);
    session.listeners.add(listener);

    return {
      dispose: () => {
        session.listeners.delete(listener);
      },
    };
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Pi backend has been disposed");
    }
  }

  private assertReady(): void {
    this.assertNotDisposed();
    if (!this.initialized) {
      throw new Error("Pi backend must be initialized before use");
    }
  }

  private allocateSessionId(): string {
    this.sessionCounter += 1;
    return `pi_session_${this.sessionCounter}_${randomUUID()}`;
  }

  private allocateMessageId(): string {
    this.messageCounter += 1;
    return `pi_message_${this.messageCounter}_${randomUUID()}`;
  }

  private createSessionState(sessionId: string): PiSessionState {
    const createdAt = nowIso();
    return {
      sessionId,
      createdAt,
      updatedAt: createdAt,
      name: null,
      modelId: this.models.find((model) => model.isDefault)?.id ?? null,
      disposed: false,
      messages: [],
      listeners: new Set(),
    };
  }

  private getSessionOrThrow(sessionId: string): PiSessionState {
    const session = this.sessions.get(sessionId);
    if (!session || session.disposed) {
      throw new Error(`Unknown Pi session: ${sessionId}`);
    }
    return session;
  }

  private ensureModelExists(modelId: string): void {
    if (!this.models.some((model) => model.id === modelId)) {
      throw new Error(`Unknown Pi model: ${modelId}`);
    }
  }
}

export function createPiBackend(options: PiBackendOptions = {}): PiBackend {
  return new PiBackend(options);
}

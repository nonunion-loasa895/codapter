import type { BackendModelSummary, IBackend, ParsedBackendSelection } from "./backend.js";
import { encodeBackendModelId, parseBackendModelId } from "./backend.js";

interface AggregatedModelEntry extends BackendModelSummary {
  readonly backendType: string;
}

function cloneModel(model: BackendModelSummary): BackendModelSummary {
  return {
    ...model,
    inputModalities: [...model.inputModalities],
    supportedReasoningEfforts: [...model.supportedReasoningEfforts],
  };
}

function toAggregatedModel(backendType: string, model: BackendModelSummary): AggregatedModelEntry {
  const prefixedId = encodeBackendModelId(backendType, model.id);
  return {
    ...cloneModel(model),
    id: prefixedId,
    model: encodeBackendModelId(backendType, model.model),
    displayName: `${backendType} / ${model.displayName}`,
    isDefault: model.isDefault,
    backendType,
  };
}

export interface RoutedBackendSelection {
  readonly backend: IBackend;
  readonly selection: ParsedBackendSelection;
}

export class BackendRouter {
  private readonly backends = new Map<string, IBackend>();
  private readonly backendOrder: string[] = [];

  constructor(backends: readonly IBackend[] = []) {
    for (const backend of backends) {
      this.register(backend);
    }
  }

  register(backend: IBackend): void {
    if (this.backends.has(backend.backendType)) {
      throw new Error(`Duplicate backend type: ${backend.backendType}`);
    }
    this.backends.set(backend.backendType, backend);
    this.backendOrder.push(backend.backendType);
  }

  listBackendTypes(): readonly string[] {
    return [...this.backendOrder];
  }

  getBackend(backendType: string): IBackend | null {
    return this.backends.get(backendType) ?? null;
  }

  requireBackend(backendType: string): IBackend {
    const backend = this.getBackend(backendType);
    if (!backend) {
      throw new Error(`Unknown backend type: ${backendType}`);
    }
    return backend;
  }

  parseModelSelection(model: string | null | undefined): RoutedBackendSelection | null {
    if (!model) {
      return null;
    }

    const prefixed = parseBackendModelId(model);
    if (!prefixed) {
      return null;
    }

    const backend = this.getBackend(prefixed.backendType);
    if (!backend) {
      return null;
    }

    const parsed = backend.parseModelSelection(model);
    if (!parsed) {
      return null;
    }

    return {
      backend,
      selection: parsed,
    };
  }

  async listModels(): Promise<BackendModelSummary[]> {
    const candidates: AggregatedModelEntry[] = [];

    for (const backendType of this.backendOrder) {
      const backend = this.backends.get(backendType);
      if (!backend || !backend.isAlive()) {
        continue;
      }
      let models: readonly BackendModelSummary[];
      try {
        models = await backend.listModels();
      } catch {
        continue;
      }
      for (const model of models) {
        candidates.push(toAggregatedModel(backend.backendType, model));
      }
    }

    const preferredDefault =
      candidates.find((model) => model.isDefault) ??
      candidates.find((model) => !model.hidden) ??
      null;
    const defaultId = preferredDefault?.id ?? null;

    return candidates.map((model) => ({
      ...model,
      isDefault: defaultId !== null && model.id === defaultId,
    }));
  }

  async resolveModelSelection(model: string | null | undefined): Promise<RoutedBackendSelection> {
    if (model) {
      const parsed = this.parseModelSelection(model);
      if (!parsed) {
        const prefixed = parseBackendModelId(model);
        if (!prefixed) {
          throw new Error(`Model id is not backend-prefixed: ${model}`);
        }
        if (!this.backends.has(prefixed.backendType)) {
          throw new Error(`Unknown backend prefix: ${prefixed.backendType}`);
        }
        throw new Error(`Invalid backend model id: ${model}`);
      }
      if (!parsed.backend.isAlive()) {
        throw new Error(`Backend ${parsed.selection.backendType} is unavailable`);
      }
      return parsed;
    }

    const models = await this.listModels();
    const defaultModel = models.find((entry) => entry.isDefault) ?? null;
    if (!defaultModel) {
      throw new Error("No healthy backend models available");
    }

    const parsed = this.parseModelSelection(defaultModel.id);
    if (!parsed) {
      throw new Error(`Failed to parse default model id: ${defaultModel.id}`);
    }

    return parsed;
  }
}

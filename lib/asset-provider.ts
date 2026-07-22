import type {
  PixelPetActionExtensionRequest,
  PixelPetActionPack,
  PixelPetProfile,
  PixelPetQaMetrics,
} from "./pixel-pet";
import type { BackgroundAssetRecord, BackgroundSceneDescriptor, BackgroundWorldIndex } from "./background-assets";

export type PixelPetForgeRequest = {
  agentId: string;
  name: string;
  personality: string;
  background: string;
  promptBrief: string;
  referenceUrl: string;
  output: {
    style: "pixel";
    columns: 4;
    rows: 5;
    actions: Array<"idle" | "walk" | "wave" | "cry" | "love">;
    transparentBackground: true;
    normalizedBaseline: true;
  };
};

export type PixelPetForgeResult = Pick<
  PixelPetProfile,
  "schema" | "provider" | "sourceName" | "referenceUrl" | "spriteSheetUrl" | "grid" | "anchor" | "generatedAt"
> & {
  qa: PixelPetQaMetrics;
};

/** The provider keeps the legacy pixel-pet package protocol behind CP 跳动's character-facing API. */
export interface PixelPetAgentProvider {
  forgePet(request: PixelPetForgeRequest): Promise<PixelPetForgeResult>;
  extendActions(request: PixelPetActionExtensionRequest): Promise<PixelPetActionPack>;
}

export type BackgroundAssetResolveRequest = {
  operation: "resolve";
  worldId: string;
  scene: BackgroundSceneDescriptor;
};

export type BackgroundAssetGenerateRequest = {
  operation: "generate";
  worldId: string;
  scene: BackgroundSceneDescriptor;
  explicitGenerationConsent: true;
  requestSource: "owner-ui";
};

export type BackgroundAssetAgentResult = {
  schema: "cp-dance/background-agent-result/v1";
  status: "reused" | "generated" | "no-match";
  asset: BackgroundAssetRecord | null;
  worldIndex: BackgroundWorldIndex;
  generationTriggered?: boolean;
  masterIndexUpdated?: boolean;
};

/** Background selection/generation is a separate asset sub-agent and never controls characters or relationship state. */
export interface BackgroundAssetAgentProvider {
  resolveBackground(request: BackgroundAssetResolveRequest): Promise<BackgroundAssetAgentResult>;
  generateBackground(request: BackgroundAssetGenerateRequest): Promise<BackgroundAssetAgentResult>;
}

export type PixelPetInteractionProposal = {
  initiatorId: string;
  responderId: string;
  action: "talk" | "cuddle" | string;
  requiresConsent: boolean;
};

export type PixelPetInteractionResponse = {
  proposal: PixelPetInteractionProposal;
  response: "accept" | "delay" | "reject" | "counter";
  fallbackAction: "shy" | "angry" | "listen" | "idle";
  reason: string;
};

/** Pair animation starts only after the responder Agent accepts the proposal. */
export interface PixelPetInteractionCoordinator {
  propose(proposal: PixelPetInteractionProposal): Promise<PixelPetInteractionResponse>;
}

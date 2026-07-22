import type { BackgroundAssetRecord, BackgroundSceneDescriptor, BackgroundWorldIndex } from "@/lib/background-assets";

type BackgroundAgentResult = {
  schema: "cp-dance/background-agent-result/v1";
  operation: "resolve";
  status: "reused" | "generated" | "no-match";
  asset: BackgroundAssetRecord | null;
  generationTriggered: boolean;
  masterIndexUpdated?: boolean;
  worldIndex: BackgroundWorldIndex;
  error?: string;
};

export async function resolveBackgroundAsset(worldId: string, scene: BackgroundSceneDescriptor) {
  const response = await fetch("/api/ai/background", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "resolve", worldId, scene }),
  });
  const payload = await response.json().catch(() => null) as BackgroundAgentResult | null;
  if (!response.ok || !payload) throw new Error(payload?.error || "背景资产 Agent 暂不可用");
  return payload;
}

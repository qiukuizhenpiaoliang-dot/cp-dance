import type { DirectorDecision, DirectorOutline, DirectorTask } from "@/lib/director-types";
import type { StoryCompactionTask, StoryContextSummary } from "@/lib/story-context-types";

type DirectorApiResponse = {
  outline: DirectorOutline | null;
  decision: DirectorDecision;
  model: string;
  error?: string;
};

export async function requestDirectorDecision(task: DirectorTask): Promise<DirectorApiResponse> {
  const response = await fetch("/api/ai/director", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(task),
  });
  const payload = await response.json().catch(() => null) as DirectorApiResponse | null;
  if (!response.ok || !payload?.decision || (task.taskType === "create_outline" && !payload.outline)) {
    throw new Error(payload?.error || "Director Agent 没有返回可运行的故事决策");
  }
  return payload;
}

export async function requestStoryCompaction(task: StoryCompactionTask): Promise<{ summary: StoryContextSummary; model: string }> {
  const response = await fetch("/api/ai/director", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(task),
  });
  const payload = await response.json().catch(() => null) as { summary?: StoryContextSummary; model?: string; error?: string } | null;
  if (!response.ok || !payload?.summary) throw new Error(payload?.error || "Story Context Compactor 没有返回有效摘要");
  return { summary: payload.summary, model: payload.model || "文本模型" };
}

"use client";

import { type ChangeEvent, useState } from "react";
import type { StoryAgent } from "@/lib/agent-engine";
import {
  DEMO_REFERENCE_URL,
  canSmartRepairSpriteSheet,
  createPixelPetForgeSnapshot,
  createPixelPetActionExtensionRequest,
  createPresetEmotionPack,
  mergePixelPetActionPacks,
  needsSpriteSheetRepair,
  PIXEL_PET_PRESETS,
  PIXEL_PET_PIPELINE,
  restorePreviousPixelPetForge,
  type PixelPetProfile,
  type PixelPetQaMetrics,
} from "@/lib/pixel-pet";
import {
  forgePixelPet,
  forgePixelPetFallback,
  generatePixelPetActionPack,
  normalizeReferenceFile,
  type PixelPetForgeResult,
} from "./pixel-pet-runtime";
import { InteractivePixelPetPlayground } from "./PixelPetSprite";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

type Props = {
  agent: StoryAgent;
  onComplete: (visual: PixelPetProfile) => void;
  onDraft: (visual: PixelPetProfile) => void;
  onClose: () => void;
};

export function PixelPetForge({ agent, onComplete, onDraft, onClose }: Props) {
  const initialNeedsRepair = needsSpriteSheetRepair(agent.visual);
  const initialCanSmartRepair = canSmartRepairSpriteSheet(agent.visual);
  const initialPreset = PIXEL_PET_PRESETS.find((preset) => preset.spriteSheetUrl === agent.visual.spriteSheetUrl)
    || (agent.visual.usesDemoAsset ? PIXEL_PET_PRESETS[0] : null);
  const [referenceUrl, setReferenceUrl] = useState(agent.visual.referenceUrl || DEMO_REFERENCE_URL);
  const [sourceName, setSourceName] = useState(agent.visual.sourceName || "尚未上传参考图");
  const [presetId, setPresetId] = useState<string | null>(initialPreset?.id || null);
  const [pipelineStep, setPipelineStep] = useState(agent.visual.status === "ready" ? 4 : -1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [qa, setQa] = useState<PixelPetQaMetrics | null>(agent.visual.qa);
  const [preview, setPreview] = useState<PixelPetProfile>(agent.visual);
  const [error, setError] = useState("");
  const [generationNotice, setGenerationNotice] = useState(initialNeedsRepair
    ? initialCanSmartRepair
      ? "旧版动作表正在使用前景识别智能修复；无需重新生图即可恢复完整角色帧"
      : "旧版动作表存在不可恢复的裁切风险，当前使用完整待机帧保护；请重新制作以恢复全部动作"
    : agent.visual.generationMode === "aigc" ? `${agent.visual.generationModel || "图像模型"} 已生成角色动作表` : agent.visual.generationWarning || "");
  const [canUseLocalFallback, setCanUseLocalFallback] = useState(false);
  const [isUsingFallback, setIsUsingFallback] = useState(false);
  const [actionRequest, setActionRequest] = useState("害羞、生气、交谈、倾听");
  const [isExtending, setIsExtending] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const normalized = await normalizeReferenceFile(file);
      setReferenceUrl(normalized);
      setSourceName(file.name);
      setPresetId(null);
      setPipelineStep(-1);
      setQa(null);
      setGenerationNotice("");
      setCanUseLocalFallback(false);
      const draft = { ...preview, status: "draft" as const, referenceUrl: normalized, spriteSheetUrl: null, qa: null, generationMode: null, generationModel: null, generationWarning: null, orientationProtocol: null, spriteNormalizationVersion: null, actionRevision: 1, actionPacks: [], previousForge: createPixelPetForgeSnapshot(preview), usesDemoAsset: false };
      setPreview(draft);
      onDraft(draft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图片读取失败");
    }
  }

  function selectPreset(id: string) {
    const preset = PIXEL_PET_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setReferenceUrl(preset.referenceUrl);
    setSourceName(preset.sourceName);
    setPresetId(preset.id);
    setPipelineStep(-1);
    setQa(null);
    setGenerationNotice("");
    setCanUseLocalFallback(false);
    const draft = { ...preview, status: "draft" as const, referenceUrl: preset.referenceUrl, spriteSheetUrl: null, qa: null, generationMode: null, generationModel: null, generationWarning: null, orientationProtocol: null, spriteNormalizationVersion: null, actionRevision: 1, actionPacks: [], previousForge: createPixelPetForgeSnapshot(preview), usesDemoAsset: preset.demoHue };
    setPreview(draft);
    onDraft(draft);
  }

  function completeForge(result: PixelPetForgeResult) {
    const preset = PIXEL_PET_PRESETS.find((item) => item.id === presetId);
    const visual: PixelPetProfile = {
      ...preview,
      status: "ready",
      provider: "pixel-pet-agent",
      sourceName: result.generationMode === "aigc" ? `${agent.name}-${result.generationModel || "aigc"}.png` : sourceName,
      referenceUrl,
      spriteSheetUrl: result.spriteSheetUrl,
      grid: { columns: 4, rows: result.rows, frameWidth: result.frameWidth, frameHeight: result.frameHeight },
      interactionRig: result.interactionRig,
      qa: result.qa,
      generatedAt: new Date().toISOString(),
      generationModel: result.generationModel,
      generationMode: result.generationMode,
      generationWarning: result.warning,
      orientationProtocol: result.orientationProtocol,
      spriteNormalizationVersion: result.spriteNormalizationVersion,
      previousForge: createPixelPetForgeSnapshot(preview),
      usesDemoAsset: result.generationMode === "aigc" ? false : preset?.demoHue || false,
    };
    setQa(result.qa);
    setPipelineStep(result.generationMode === "aigc" ? 4 : -1);
    setGenerationNotice(result.generationMode === "aigc"
      ? `${result.generationModel} 已生成 20 帧三朝向动作表，朝向、骨骼与 QA 已完成`
      : result.warning || "已明确使用本地预览");
    setCanUseLocalFallback(false);
    setPreview(visual);
    onComplete(visual);
  }

  function rollbackForge() {
    if (isGenerating || isUsingFallback || isExtending) return;
    const restored = restorePreviousPixelPetForge(preview);
    if (!restored) return;
    const restoredPreset = PIXEL_PET_PRESETS.find((item) => item.spriteSheetUrl === restored.spriteSheetUrl || item.referenceUrl === restored.referenceUrl);
    setReferenceUrl(restored.referenceUrl || DEMO_REFERENCE_URL);
    setSourceName(restored.sourceName);
    setPresetId(restoredPreset?.id || null);
    setPipelineStep(restored.generationMode === "aigc" ? 4 : -1);
    setQa(restored.qa);
    setPreview(restored);
    setError("");
    setCanUseLocalFallback(false);
    setGenerationNotice(`已回滚到上次制作的角色动作${restored.generatedAt ? ` · ${new Date(restored.generatedAt).toLocaleString("zh-CN")}` : ""}`);
    onComplete(restored);
  }

  async function runForge() {
    if (isGenerating || isUsingFallback) return;
    setIsGenerating(true);
    setError("");
    setCanUseLocalFallback(false);
    setGenerationNotice("正在检查并调用真实角色制作 Agent；只有 Agent 结果通过 QA 才会保存");
    try {
      setPipelineStep(0);
      await wait(280);
      setPipelineStep(1);
      const preset = PIXEL_PET_PRESETS.find((item) => item.id === presetId);
      const result = await forgePixelPet({
        name: agent.name,
        personality: agent.personality,
        background: agent.background,
        referenceUrl,
        usesPresetAsset: Boolean(preset),
        presetSpriteSheetUrl: preset?.spriteSheetUrl,
      });
      await wait(420);
      setPipelineStep(2);
      await wait(320);
      setPipelineStep(3);
      setQa(result.qa);
      await wait(360);
      completeForge(result);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "可交互角色制作失败";
      setPipelineStep(-1);
      setGenerationNotice(`真实角色制作 Agent 未完成：${message}`);
      setError(`${message}。本次未自动降级，也未保存新的角色动作。`);
      setCanUseLocalFallback(true);
    } finally {
      setIsGenerating(false);
    }
  }

  async function runLocalFallback() {
    if (isGenerating || isUsingFallback) return;
    setIsUsingFallback(true);
    setError("");
    setGenerationNotice("正在创建显式本地预览；此过程不会调用角色制作 Agent");
    try {
      const preset = PIXEL_PET_PRESETS.find((item) => item.id === presetId);
      const result = await forgePixelPetFallback({
        name: agent.name,
        personality: agent.personality,
        background: agent.background,
        referenceUrl,
        usesPresetAsset: Boolean(preset),
        presetSpriteSheetUrl: preset?.spriteSheetUrl,
      });
      completeForge(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "本地预览创建失败");
    } finally {
      setIsUsingFallback(false);
    }
  }

  async function appendActions() {
    if (isExtending || preview.status !== "ready" || !actionRequest.trim()) return;
    const preset = PIXEL_PET_PRESETS.find((item) => item.id === presetId);
    const requestedActions = actionRequest.split(/[，,、\s]+/).map((item) => item.trim()).filter(Boolean).slice(0, 4);
    if (requestedActions.some((action) => /贴贴|拥抱|牵手/.test(action))) {
      setError("贴贴、拥抱、牵手属于双角色动作，需要在“双角色互动”入口生成并经过接收者同意。");
      return;
    }
    const extensionRequest = createPixelPetActionExtensionRequest(preview, requestedActions);
    const prebuiltActions = new Set(["害羞", "生气", "交谈", "倾听"]);
    const canUsePrebuilt = Boolean(preset) && preview.generationMode !== "aigc" && requestedActions.every((action) => prebuiltActions.has(action));
    setIsExtending(true);
    setError("");
    setGenerationNotice(`动作 Agent 正在读取 ${extensionRequest.parentVersion}，以 ${extensionRequest.mergePolicy} 策略追加新帧`);
    try {
      const pack = canUsePrebuilt && preset
        ? createPresetEmotionPack(preset.id, actionRequest.trim())
        : await generatePixelPetActionPack({ visual: preview, requestedActions });
      if (!pack) throw new Error("没有找到可合并的动作包");
      if (canUsePrebuilt) await wait(760);
      const nextVisual: PixelPetProfile = {
        ...preview,
        actionRevision: (preview.actionRevision || 1) + 1,
        actionPacks: mergePixelPetActionPacks(preview.actionPacks, [pack]),
        generatedAt: new Date().toISOString(),
      };
      setPreview(nextVisual);
      onComplete(nextVisual);
      setGenerationNotice(`已合并 ${pack.id}：${Object.values(pack.actions).map((action) => action.label).join(" / ")}；旧动作保持不变`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "增量动作生成失败");
    } finally {
      setIsExtending(false);
    }
  }

  const score = qa ? Math.round(qa.orientationCoverage > 0
    ? qa.identity * 0.3 + qa.transparentCorners * 0.2 + Math.min(100, (qa.actionDiversity || 0) * 4) * 0.25 + qa.orientationCoverage * 0.25
    : qa.identity * 0.35 + qa.transparentCorners * 0.25 + Math.min(100, (qa.actionDiversity || 0) * 4) * 0.4) : null;
  const selectedPreset = PIXEL_PET_PRESETS.find((preset) => preset.id === presetId);

  return (
    <section className="pet-forge" aria-label={`为${agent.name}制作可交互角色`}>
      <div className="pet-forge-heading">
        <div><p>INTERACTIVE CHARACTER / 4 × 5</p><h3>为 {agent.name} 制作角色动作</h3></div>
        <button type="button" onClick={onClose}>收起制作面板 ×</button>
      </div>

      <div className="pet-forge-workspace">
        <div className="pet-reference-card">
          <span className="forge-label">01 / REFERENCE</span>
          <label className="pet-reference-drop">
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} />
            {referenceUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={referenceUrl} alt={`${agent.name}的角色参考图`} />
            ) : <span className="pet-reference-empty">上传你有权使用的参考图</span>}
            <b>{referenceUrl ? "点击替换参考图" : "点击选择参考图"}</b>
          </label>
          <div className="pet-source-meta"><span>{sourceName}</span></div>
          {PIXEL_PET_PRESETS.length > 0 ? <div className="pet-preset-list" aria-label="选择角色预设">
            {PIXEL_PET_PRESETS.map((preset) => <button className={presetId === preset.id ? "active" : ""} type="button" key={preset.id} onClick={() => selectPreset(preset.id)}><b>{preset.name}</b></button>)}
          </div> : <p className="pet-assets-note">开源仓库不附带角色预设，请上传自有或已获授权的素材。</p>}
        </div>

        <div className="pet-forge-main">
          <span className="forge-label">02 / AGENT PIPELINE</span>
          <div className="pet-pipeline">
            {PIXEL_PET_PIPELINE.map((step, index) => {
              const complete = (preview.status === "ready" && preview.generationMode === "aigc") || index < pipelineStep;
              const active = isGenerating && index === pipelineStep;
              return <article className={`${complete ? "complete" : ""} ${active ? "active" : ""}`} key={step.label}><i>{complete ? "✓" : active ? "···" : `0${index + 1}`}</i><strong>{step.label}</strong><span>{step.detail}</span></article>;
            })}
          </div>
          <div className="pet-action-plan"><span>IDLE · F/L/R</span><span>WALK · L/R</span><span>WAVE · F/L/R</span><span>FEEL · F/L/R</span></div>
          <div className="forge-run-row">
            <button className="forge-run" type="button" onClick={runForge} disabled={isGenerating || isUsingFallback}>{isGenerating ? "REAL AGENT WORKING…" : preview.status === "ready" ? "通过真实 Agent 重新制作" : "通过真实 Agent 制作角色"}<span>{isGenerating ? "···" : "↗"}</span></button>
            {preview.previousForge && <button className="forge-rollback" type="button" onClick={rollbackForge} disabled={isGenerating || isUsingFallback || isExtending}>回滚到上次制作 ↶</button>}
          </div>
          <p className={`forge-model-status ${preview.generationMode === "aigc" ? "active" : ""}`}><b>IMAGE AGENT · SERVER</b><span>{generationNotice || "只接受真实 Agent 生成且通过 QA 的 4 × 5 三朝向动作表；失败不会自动降级"}</span></p>
          {error && <p className="forge-error" role="alert">{error}</p>}
          {canUseLocalFallback && <div className="forge-fallback-choice"><button type="button" onClick={runLocalFallback} disabled={isUsingFallback}>{isUsingFallback ? "正在创建本地预览…" : "明确使用本地预览继续"}</button></div>}
          <div className="pet-action-agent"><span>04 / INCREMENTAL ACTION AGENT</span><label><input value={actionRequest} maxLength={100} onChange={(event) => setActionRequest(event.target.value)} aria-label="需要追加的角色动作" /><button type="button" onClick={appendActions} disabled={isExtending || preview.status !== "ready"}>{isExtending ? "合并中…" : "追加并合并"}</button></label><p>REV {preview.actionRevision || 1} · {preview.actionPacks?.length || 0} 个增量包 · APPEND ONLY</p></div>
        </div>

        <div className="pet-forge-preview">
          <span className="forge-label">03 / LIVE &amp; QA</span>
          <InteractivePixelPetPlayground visual={preview} name={agent.name} />
          {qa ? <div className="forge-qa"><strong>{score}<small>/100</small></strong><div><span>身份 {qa.identity.toFixed(1)}%</span><span>基线 {qa.baseline.toFixed(1)}px</span><span>透明 {qa.transparentCorners.toFixed(1)}% · 背景一致 {(qa.backgroundUniformity || 0).toFixed(1)}%</span><span>完整帧 {(qa.frameCompleteness ?? 0).toFixed(1)}% · 边界置信 {(qa.boundaryConfidence ?? 0).toFixed(1)}%</span><span>动作差异 {(qa.actionDiversity || 0).toFixed(1)}% · {qa.uniquePoseCount || 0} 个独立姿势</span><span>{qa.orientationCoverage > 0 ? `朝向覆盖 ${qa.orientationCoverage.toFixed(1)}%` : "旧资源·镜像兼容"}</span><span>骨骼 {preview.interactionRig.source === "alpha-analysis" ? "轮廓分析" : "安全估算"} · 7 锚点</span></div></div> : <p className="forge-waiting">完成制作后显示逐帧 QA 与互动骨骼</p>}
          {selectedPreset?.interactiveUrl && preview.status === "ready" && <div className="interactive-pet-package-links"><a href={selectedPreset.interactiveUrl} target="_blank" rel="noreferrer">打开独立互动包 ↗</a><a href={selectedPreset.interactionUrl || "#"} target="_blank" rel="noreferrer">双角色互动 ↗</a><a href={selectedPreset.packageUrl || "#"} download>下载 ZIP ↓</a><a href={selectedPreset.configUrl || "#"} download>配置 ↓</a></div>}
        </div>
      </div>
      <p className="forge-footnote">参考图同时锁定人物外观与画风；名字和设定只影响动作、情绪，不会授权改脸、换装或换画风。{presetId ? `“${selectedPreset?.name}”会作为参考图发送给服务端角色制作 Agent；失败时不会自动创建或保存降级角色。` : "上传的参考图会发送给已配置的角色制作 Agent；密钥只在服务端使用。Agent 失败后只有点击明确的本地预览按钮才会降级。"}</p>
    </section>
  );
}

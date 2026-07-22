"use client";

import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { InitialRelationKind, RelationshipDraft, StoryAgent } from "@/lib/agent-engine";
import type { PixelPetRuntimeActionName } from "@/lib/pixel-pet";
import { PixelPetSprite } from "./PixelPetSprite";

type Position = { x: number; y: number };

const relationKinds: InitialRelationKind[] = ["初识", "旧识", "朋友", "同伴", "亲属", "单恋", "宿敌", "自定义"];
const relationKindLabel = (kind: InitialRelationKind) => kind === "朋友" ? "挚友" : kind === "亲属" ? "挚爱" : kind;
const defaultPositions: Position[] = [
  { x: 50, y: 48 },
  { x: 50, y: 48 },
  { x: 50, y: 48 },
];

const interactionScenes: Array<{
  label: string;
  detail: string;
  kind: "conversation" | "greeting" | "approach" | "cuddle";
  left: PixelPetRuntimeActionName;
  right: PixelPetRuntimeActionName;
}> = [
  { label: "交谈", detail: "一人表达，一人安静回应", kind: "conversation", left: "talk", right: "listen" },
  { label: "招呼", detail: "两人先用动作确认彼此", kind: "greeting", left: "wave", right: "wave" },
  { label: "靠近", detail: "面向彼此并缩短到可互动距离", kind: "approach", left: "walk", right: "listen" },
  { label: "心动", detail: "双人动作会同步；进入世界后仍需同意", kind: "cuddle", left: "love", right: "love" },
];

type Props = {
  agents: StoryAgent[];
  drafts: RelationshipDraft[];
  onChange: (draft: RelationshipDraft) => void;
};

export function RelationshipGraphEditor({ agents, drafts, onChange }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, Position>>(() => {
    const layout = agents.length === 3 ? [{ x: 50, y: 21 }, { x: 24, y: 73 }, { x: 76, y: 73 }] : agents.length === 2 ? [{ x: 24, y: 52 }, { x: 76, y: 52 }] : defaultPositions;
    return Object.fromEntries(agents.map((agent, index) => [agent.id, layout[index]]));
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(drafts[0]?.id || null);
  const [previewBeat, setPreviewBeat] = useState(0);
  const effectiveSelectedId = drafts.some((draft) => draft.id === selectedId) ? selectedId : drafts[0]?.id || null;
  const selected = drafts.find((draft) => draft.id === effectiveSelectedId);
  const selectedAgents = useMemo(() => selected ? {
    a: agents.find((agent) => agent.id === selected.a),
    b: agents.find((agent) => agent.id === selected.b),
  } : null, [agents, selected]);
  const previewAgents = selectedAgents?.a && selectedAgents.b ? [selectedAgents.a, selectedAgents.b] : agents.slice(0, 2);
  const previewScene = interactionScenes[previewBeat % interactionScenes.length];

  useEffect(() => {
    const timer = window.setInterval(() => setPreviewBeat((value) => (value + 1) % interactionScenes.length), 3200);
    return () => window.clearInterval(timer);
  }, []);

  function beginDrag(agentId: string, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDraggingId(agentId);
    canvasRef.current?.setPointerCapture(event.pointerId);
    const firstRelation = drafts.find((draft) => draft.a === agentId || draft.b === agentId);
    if (firstRelation) setSelectedId(firstRelation.id);
  }

  function moveNode(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingId || !canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    const x = Math.max(12, Math.min(88, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.max(16, Math.min(84, ((event.clientY - bounds.top) / bounds.height) * 100));
    setPositions((current) => ({ ...current, [draggingId]: { x, y } }));
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    setDraggingId(null);
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) canvasRef.current.releasePointerCapture(event.pointerId);
  }

  function update(patch: Partial<RelationshipDraft>) {
    if (selected) onChange({ ...selected, ...patch, researchSuggested: false });
  }

  return (
    <section className="relationship-binding" aria-labelledby="relationship-binding-title">
      <div className="relationship-binding-heading">
        <div><p>02 / RELATIONSHIP GRAPH</p><h3 id="relationship-binding-title">绑定角色关系网</h3></div>
        <span>{drafts.length ? `${drafts.length} 条关系边` : "单角色 · 无需连线"}</span>
      </div>
      <p className="relationship-binding-copy">关系设定只作为模拟开始时的主观初值。</p>

      <section className="relationship-live-preview" aria-label="已完成角色互动预览">
        <header>
          <div><span>LIVE CAST / INTERACTION PREVIEW</span><strong>{previewAgents.length > 1 ? `${previewAgents[0].name} × ${previewAgents[1].name}` : `${previewAgents[0]?.name || "角色"}的单人预览`}</strong></div>
          <p><b>{previewScene.label}</b>{previewScene.detail}{previewAgents.length > 1 && <small><i>♥</i> 动作预览不代表预设同意</small>}</p>
        </header>
        <div className={`relationship-live-stage scene-${previewScene.kind} ${previewAgents.length === 1 ? "solo" : ""}`}>
          <div className="relationship-live-floor" />
          {previewAgents.map((agent, index) => (
            <div className={`relationship-live-agent agent-${index + 1}`} key={agent.id}>
              <span>{index === 0 ? previewScene.label : previewScene.right === "listen" ? "回应" : previewScene.label}</span>
              <PixelPetSprite visual={agent.visual} name={agent.name} action={index === 0 ? previewScene.left : previewScene.right} facing={index === 0 ? "right" : "left"} interactive />
              <strong>{agent.name}</strong>
            </div>
          ))}
        </div>
        <div className="relationship-live-controls" aria-label="切换互动动作预览">
          {interactionScenes.map((scene, index) => <button className={previewBeat === index ? "active" : ""} type="button" onClick={() => setPreviewBeat(index)} aria-pressed={previewBeat === index} key={scene.label}>{scene.label}</button>)}
        </div>
      </section>

      <div className={`relationship-graph-layout ${agents.length === 1 ? "solo" : ""}`}>
        <div className="relationship-graph-canvas" ref={canvasRef} onPointerMove={moveNode} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <svg className="relationship-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {drafts.map((draft) => {
              const from = positions[draft.a];
              const to = positions[draft.b];
              return from && to ? <line key={draft.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={draft.id === effectiveSelectedId ? "selected" : ""} /> : null;
            })}
          </svg>
          {drafts.map((draft) => {
            const from = positions[draft.a];
            const to = positions[draft.b];
            if (!from || !to) return null;
            return <button key={draft.id} className={`relationship-edge-button ${draft.id === effectiveSelectedId ? "selected" : ""}`} style={{ left: `${(from.x + to.x) / 2}%`, top: `${(from.y + to.y) / 2}%` }} type="button" onClick={() => setSelectedId(draft.id)}>{relationKindLabel(draft.aToB.kind)} ↔ {relationKindLabel(draft.bToA.kind)}</button>;
          })}
          {agents.map((agent) => {
            const position = positions[agent.id] || defaultPositions[0];
            return <button key={agent.id} className={`relationship-node ${draggingId === agent.id ? "dragging" : ""}`} style={{ left: `${position.x}%`, top: `${position.y}%` }} type="button" onPointerDown={(event) => beginDrag(agent.id, event)} aria-label={`拖动${agent.name}的关系节点`}><PixelPetSprite visual={agent.visual} name={agent.name} small /><strong>{agent.name}</strong><small>拖动</small></button>;
          })}
          {agents.length === 1 && <div className="solo-graph-note"><b>一个人无需关系连线</b><p>可交互角色已经完成，可以直接确认并进入世界。</p></div>}
        </div>

        {selected && selectedAgents?.a && selectedAgents.b ? (
          <div className="relationship-edge-editor">
            <div className="edge-editor-heading"><span>正在编辑</span><strong>{selectedAgents.a.name} ↔ {selectedAgents.b.name}</strong></div>
            <label><span>{selectedAgents.a.name} → {selectedAgents.b.name}</span><select value={selected.aToB.kind} onChange={(event) => update({ aToB: { ...selected.aToB, kind: event.target.value as InitialRelationKind } })}>{relationKinds.map((kind) => <option value={kind} key={kind}>{relationKindLabel(kind)}</option>)}</select><textarea value={selected.aToB.note} maxLength={120} onChange={(event) => update({ aToB: { ...selected.aToB, note: event.target.value } })} placeholder={`例如：${selectedAgents.a.name}信任对方，但不愿先说出秘密`} /></label>
            <label><span>{selectedAgents.b.name} → {selectedAgents.a.name}</span><select value={selected.bToA.kind} onChange={(event) => update({ bToA: { ...selected.bToA, kind: event.target.value as InitialRelationKind } })}>{relationKinds.map((kind) => <option value={kind} key={kind}>{relationKindLabel(kind)}</option>)}</select><textarea value={selected.bToA.note} maxLength={120} onChange={(event) => update({ bToA: { ...selected.bToA, note: event.target.value } })} placeholder={`例如：${selectedAgents.b.name}把对方当作重要同伴`} /></label>
            <label className="shared-history"><span>共同经历 / 关系背景</span><textarea value={selected.sharedHistory} maxLength={180} onChange={(event) => update({ sharedHistory: event.target.value })} placeholder="例如：在社团分别是前后辈，后来因一次误会疏远。" /></label>
          </div>
        ) : (
          <div className="relationship-edge-editor solo"><strong>当前角色可以独自进入世界。</strong></div>
        )}
      </div>
    </section>
  );
}

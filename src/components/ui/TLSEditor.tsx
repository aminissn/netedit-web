"use client";

import React, { useMemo } from "react";
import { useNetworkStore } from "@/store/networkStore";
import { useUIStore } from "@/store/uiStore";
import type { TLSPhase } from "@/lib/sumo/types";

const STATE_COLORS: Record<string, string> = {
  G: "bg-green-500",
  g: "bg-green-400",
  y: "bg-yellow-400",
  r: "bg-red-500",
  s: "bg-red-300",
  o: "bg-orange-400",
  O: "bg-orange-300",
};

interface Props {
  junctionId: string;
}

export default function TLSEditor({ junctionId }: Props) {
  const network = useNetworkStore((s) => s.network);
  const networkVersion = useNetworkStore((s) => s.networkVersion);
  const doSetJunctionType = useNetworkStore((s) => s.doSetJunctionType);
  const doSetTLSOffset = useNetworkStore((s) => s.doSetTLSOffset);
  const doSetTLSType = useNetworkStore((s) => s.doSetTLSType);
  const doSetTLSPhaseDuration = useNetworkStore((s) => s.doSetTLSPhaseDuration);
  const doSetTLSPhaseState = useNetworkStore((s) => s.doSetTLSPhaseState);
  const doSetTLSPhaseMinDur = useNetworkStore((s) => s.doSetTLSPhaseMinDur);
  const doSetTLSPhaseMaxDur = useNetworkStore((s) => s.doSetTLSPhaseMaxDur);
  const doAddTLSPhase = useNetworkStore((s) => s.doAddTLSPhase);
  const doRemoveTLSPhase = useNetworkStore((s) => s.doRemoveTLSPhase);
  const selectedTLSPhase = useUIStore((s) => s.selectedTLSPhase);
  const setSelectedTLSPhase = useUIStore((s) => s.setSelectedTLSPhase);

  const junction = network?.junctions.get(junctionId);
  const tls = useMemo(
    () => network?.tlLogics.find((t) => t.id === junctionId),
    [network?.tlLogics, networkVersion, junctionId]
  );
  
  const selectedPhaseIndex = selectedTLSPhase.get(junctionId);

  if (!junction) return null;

  const isTLS = junction.type === "traffic_light";

  return (
    <div className="absolute right-2 top-16 z-10 w-96 bg-gray-800/95 rounded-lg shadow-lg backdrop-blur-sm overflow-hidden">
      <div className="px-3 py-2 bg-gray-700 text-sm font-semibold text-gray-200 border-b border-gray-600">
        Traffic Light: {junctionId}
      </div>
      <div className="p-3 text-sm">
        {!isTLS ? (
          <div className="space-y-2">
            <div className="text-gray-400">
              Junction type is &quot;{junction.type}&quot;. Change to traffic_light to add signals.
            </div>
            <button
              onClick={() => doSetJunctionType(junctionId, "traffic_light")}
              className="w-full px-3 py-1.5 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-500"
            >
              Set as Traffic Light
            </button>
          </div>
        ) : (
            <div className="space-y-3">
              <div className="flex justify-between text-xs text-gray-400 mb-2">
                <span>Program: {tls?.programID ?? "0"}</span>
              </div>
              {tls && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">Type</span>
                    <select
                      value={tls.type}
                      onChange={(e) => doSetTLSType(junctionId, e.target.value as "static" | "actuated")}
                      className="bg-gray-700 text-white text-xs px-2 py-1 rounded border border-gray-600 w-32"
                    >
                      <option value="static">static</option>
                      <option value="actuated">actuated</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">Offset</span>
                    <input
                      type="number"
                      value={tls.offset}
                      onChange={(e) => doSetTLSOffset(junctionId, Number(e.target.value))}
                      className="bg-gray-700 text-white text-xs px-2 py-1 rounded border border-gray-600 w-32"
                    />
                  </div>
                </div>
              )}

              {tls && tls.phases.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs text-gray-400 mb-1">
                    Phases ({tls.phases.length})
                  </div>
                  <div className="space-y-1.5">
                    {tls.phases.map((phase, i) => (
                      <PhaseRow
                        key={i}
                        index={i}
                        phase={phase}
                        junctionId={junctionId}
                        tlsType={tls.type}
                        isSelected={selectedPhaseIndex === i}
                        onSelect={() => setSelectedTLSPhase(junctionId, i)}
                        onDeselect={() => setSelectedTLSPhase(junctionId, null)}
                        onDurationChange={(v) => doSetTLSPhaseDuration(junctionId, i, v)}
                        onStateChange={(v) => doSetTLSPhaseState(junctionId, i, v)}
                        onMinDurChange={(v) => doSetTLSPhaseMinDur(junctionId, i, v)}
                        onMaxDurChange={(v) => doSetTLSPhaseMaxDur(junctionId, i, v)}
                        onRemove={() => doRemoveTLSPhase(junctionId, i)}
                      />
                    ))}
                  </div>
                  <div className="text-xs text-gray-400 pt-1">
                    Total cycle: {tls.phases.reduce((s, p) => s + p.duration, 0)}s
                  </div>
                  <button
                    onClick={() => doAddTLSPhase(junctionId)}
                    className="w-full px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-500 mt-2"
                  >
                    Add Phase
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-gray-400 text-xs">No phases defined</div>
                  <button
                    onClick={() => doAddTLSPhase(junctionId)}
                    className="w-full px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-500"
                  >
                    Add First Phase
                  </button>
                </div>
              )}

              <button
              onClick={() => doSetJunctionType(junctionId, "priority")}
              className="w-full px-3 py-1.5 bg-gray-600 text-white rounded text-xs hover:bg-gray-500"
            >
              Remove Traffic Light
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PhaseRow({
  index,
  phase,
  junctionId,
  tlsType,
  isSelected,
  onSelect,
  onDeselect,
  onDurationChange,
  onStateChange,
  onMinDurChange,
  onMaxDurChange,
  onRemove,
}: {
  index: number;
  phase: TLSPhase;
  junctionId: string;
  tlsType: "static" | "actuated" | "delay_based";
  isSelected: boolean;
  onSelect: () => void;
  onDeselect: () => void;
  onDurationChange: (duration: number) => void;
  onStateChange: (state: string) => void;
  onMinDurChange: (minDur: number) => void;
  onMaxDurChange: (maxDur: number) => void;
  onRemove: () => void;
}) {
  const hasGreen = phase.state.includes("G") || phase.state.includes("g");
  const showActuatedFields = tlsType === "actuated" && hasGreen;
  const [stateDraft, setStateDraft] = React.useState(phase.state);

  React.useEffect(() => {
    setStateDraft(phase.state);
  }, [phase.state]);

  return (
    <div
      className={`rounded px-2 py-1 space-y-1 cursor-pointer transition-colors ${
        isSelected
          ? "bg-blue-700/50 border-2 border-blue-500"
          : "bg-gray-700/50 border-2 border-transparent hover:bg-gray-700/70"
      }`}
      onClick={() => (isSelected ? onDeselect() : onSelect())}
      title={isSelected ? "Click to deselect phase" : "Click to select phase and view connection colors"}
    >
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-xs w-6">{index}</span>
        <span className="text-gray-400 text-[11px] w-8">dur</span>
        <input
          type="number"
          min={1}
          value={phase.duration}
          onChange={(e) => onDurationChange(Number(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          className="bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded border border-gray-600 w-12"
        />
        {showActuatedFields && (
          <>
            <span className="text-gray-400 text-[11px] w-8">min</span>
            <input
              type="number"
              min={1}
              value={phase.minDur ?? phase.duration}
              onChange={(e) => onMinDurChange(Number(e.target.value))}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded border border-gray-600 w-12"
            />
            <span className="text-gray-400 text-[11px] w-8">max</span>
            <input
              type="number"
              min={1}
              value={phase.maxDur ?? phase.duration}
              onChange={(e) => onMaxDurChange(Number(e.target.value))}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded border border-gray-600 w-12"
            />
          </>
        )}
        <div className="flex-1"></div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="text-[10px] px-2 py-0.5 rounded bg-red-700/80 text-red-100 hover:bg-red-600 whitespace-nowrap"
          title="Remove phase"
        >
          Remove
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-[11px] w-8">state</span>
        <input
          type="text"
          value={stateDraft}
          onChange={(e) => setStateDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => {
            if (stateDraft !== phase.state) onStateChange(stateDraft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (stateDraft !== phase.state) onStateChange(stateDraft);
            } else if (e.key === "Escape") {
              setStateDraft(phase.state);
            }
          }}
          className="bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded border border-gray-600 flex-1 font-mono min-w-0"
        />
      </div>
      <div className="flex gap-px flex-1">
        {phase.state.split("").map((s, linkIndex) => {
          const cycleState = (current: string): string => {
            // Cycle: G/g -> y -> r -> G/g
            if (current === "G" || current === "g") return "y";
            if (current === "y") return "r";
            return "G";
          };

          const handleClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            const currentState = phase.state;
            const newChar = cycleState(s);
            const newState = currentState.split("");
            newState[linkIndex] = newChar;
            onStateChange(newState.join(""));
          };

          return (
            <div
              key={linkIndex}
              onClick={handleClick}
              className={`w-4 h-5 rounded-sm flex items-center justify-center text-[9px] font-bold cursor-pointer transition-opacity hover:opacity-80 ${
                STATE_COLORS[s] ?? "bg-gray-500"
              } ${s === "G" || s === "g" ? "text-white" : s === "y" ? "text-black" : "text-white"}`}
              title={`Link ${linkIndex}: ${s} (click to cycle: G → y → r → G)`}
            >
              {linkIndex}
            </div>
          );
        })}
      </div>
    </div>
  );
}

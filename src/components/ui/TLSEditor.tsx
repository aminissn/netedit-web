"use client";

import React, { useMemo } from "react";
import { useNetworkStore } from "@/store/networkStore";
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
  const doSetJunctionType = useNetworkStore((s) => s.doSetJunctionType);

  const junction = network?.junctions.get(junctionId);
  const tls = useMemo(
    () => network?.tlLogics.find((t) => t.id === junctionId),
    [network?.tlLogics, junctionId]
  );

  if (!junction) return null;

  const isTLS = junction.type === "traffic_light";

  return (
    <div className="absolute right-2 top-16 z-10 w-80 bg-gray-800/95 rounded-lg shadow-lg backdrop-blur-sm overflow-hidden">
      <div className="px-3 py-2 bg-gray-700 text-sm font-semibold text-gray-200 border-b border-gray-600">
        Traffic Light: {junctionId}
      </div>
      <div className="p-3 max-h-[60vh] overflow-y-auto text-sm">
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
            <div className="flex justify-between text-xs text-gray-400">
              <span>Program: {tls?.programID ?? "0"}</span>
              <span>Type: {tls?.type ?? "static"}</span>
            </div>

            {tls && tls.phases.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs text-gray-400 mb-2">
                  Phases ({tls.phases.length})
                </div>
                {tls.phases.map((phase, i) => (
                  <PhaseRow key={i} index={i} phase={phase} />
                ))}
                <div className="text-xs text-gray-400 mt-2">
                  Total cycle: {tls.phases.reduce((s, p) => s + p.duration, 0)}s
                </div>
              </div>
            ) : (
              <div className="text-gray-400 text-xs">No phases defined</div>
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

function PhaseRow({ index, phase }: { index: number; phase: TLSPhase }) {
  return (
    <div className="flex items-center gap-2 bg-gray-700/50 rounded px-2 py-1">
      <span className="text-gray-400 text-xs w-4">{index}</span>
      <span className="text-gray-300 text-xs w-8">{phase.duration}s</span>
      <div className="flex gap-px flex-1">
        {phase.state.split("").map((s, i) => (
          <div
            key={i}
            className={`w-3 h-4 rounded-sm ${STATE_COLORS[s] ?? "bg-gray-500"}`}
            title={`Link ${i}: ${s}`}
          />
        ))}
      </div>
    </div>
  );
}

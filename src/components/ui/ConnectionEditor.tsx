"use client";

import React, { useMemo } from "react";
import { useNetworkStore } from "@/store/networkStore";

interface Props {
  junctionId: string;
}

export default function ConnectionEditor({ junctionId }: Props) {
  const network = useNetworkStore((s) => s.network);
  const doAddConnection = useNetworkStore((s) => s.doAddConnection);
  const doRemoveConnection = useNetworkStore((s) => s.doRemoveConnection);

  const { incomingEdges, outgoingEdges, connectionMatrix } = useMemo(() => {
    if (!network) return { incomingEdges: [], outgoingEdges: [], connectionMatrix: new Map() };

    const incoming: { edgeId: string; lanes: number }[] = [];
    const outgoing: { edgeId: string; lanes: number }[] = [];

    network.edges.forEach((edge) => {
      if (edge.to === junctionId) incoming.push({ edgeId: edge.id, lanes: edge.numLanes });
      if (edge.from === junctionId) outgoing.push({ edgeId: edge.id, lanes: edge.numLanes });
    });

    const matrix = new Map<string, boolean>();
    for (const conn of network.connections) {
      const fromEdge = network.edges.get(conn.from);
      const toEdge = network.edges.get(conn.to);
      if (fromEdge?.to === junctionId || toEdge?.from === junctionId) {
        matrix.set(`${conn.from}_${conn.fromLane}-${conn.to}_${conn.toLane}`, true);
      }
    }

    return { incomingEdges: incoming, outgoingEdges: outgoing, connectionMatrix: matrix };
  }, [network, junctionId]);

  if (!network) return null;

  const toggleConnection = (from: string, fromLane: number, to: string, toLane: number) => {
    const key = `${from}_${fromLane}-${to}_${toLane}`;
    if (connectionMatrix.has(key)) {
      doRemoveConnection(from, to, fromLane, toLane);
    } else {
      doAddConnection(from, to, fromLane, toLane);
    }
  };

  return (
    <div className="absolute right-2 top-16 z-10 w-80 bg-gray-800/95 rounded-lg shadow-lg backdrop-blur-sm overflow-hidden">
      <div className="px-3 py-2 bg-gray-700 text-sm font-semibold text-gray-200 border-b border-gray-600">
        Connections at {junctionId}
      </div>
      <div className="p-3 max-h-[60vh] overflow-y-auto text-xs">
        {incomingEdges.length === 0 || outgoingEdges.length === 0 ? (
          <div className="text-gray-400">No incoming/outgoing edges at this junction</div>
        ) : (
          <div className="space-y-3">
            {incomingEdges.map((inc) => (
              <div key={inc.edgeId}>
                <div className="text-gray-300 font-semibold mb-1">From: {inc.edgeId}</div>
                {Array.from({ length: inc.lanes }, (_, fromLane) => (
                  <div key={fromLane} className="flex items-center gap-1 mb-1">
                    <span className="text-gray-400 w-6">L{fromLane}</span>
                    <div className="flex gap-0.5 flex-wrap">
                      {outgoingEdges.map((out) =>
                        Array.from({ length: out.lanes }, (_, toLane) => {
                          const key = `${inc.edgeId}_${fromLane}-${out.edgeId}_${toLane}`;
                          const isActive = connectionMatrix.has(key);
                          return (
                            <button
                              key={key}
                              onClick={() =>
                                toggleConnection(inc.edgeId, fromLane, out.edgeId, toLane)
                              }
                              className={`w-6 h-6 rounded text-[10px] font-mono ${
                                isActive
                                  ? "bg-green-600 text-white"
                                  : "bg-gray-700 text-gray-500 hover:bg-gray-600"
                              }`}
                              title={`${inc.edgeId}[${fromLane}] -> ${out.edgeId}[${toLane}]`}
                            >
                              {toLane}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

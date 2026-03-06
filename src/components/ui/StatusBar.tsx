"use client";

import React from "react";
import { useUIStore } from "@/store/uiStore";
import { useNetworkStore } from "@/store/networkStore";

const MODE_HINTS: Record<string, string> = {
  inspect: "Click elements to inspect, drag to move, delete button in panel",
  draw: "Click to place start node, click to add geometry points, double-click to finish edge",
  createEdge: "Click a junction to start, click another to create edge",
  connection: "Click a lane to set source, click another to connect",
  tls: "Click a junction to edit traffic light signals",
};

export default function StatusBar() {
  const editMode = useUIStore((s) => s.editMode);
  const drawSubMode = useUIStore((s) => s.drawSubMode);
  const cursorPosition = useUIStore((s) => s.cursorPosition);
  const createEdgeFromJunction = useUIStore((s) => s.createEdgeFromJunction);
  const connectionFromEdge = useUIStore((s) => s.connectionFromEdge);
  const network = useNetworkStore((s) => s.network);
  const undo = useNetworkStore((s) => s.undo);
  const redo = useNetworkStore((s) => s.redo);

  let hint = MODE_HINTS[editMode] ?? "";
  if (editMode === "createEdge" && createEdgeFromJunction) {
    hint = `From: ${createEdgeFromJunction} - Click destination junction`;
  }
  if (editMode === "draw" && drawSubMode === "connection") {
    if (connectionFromEdge) {
      hint = `From: ${connectionFromEdge} - Click destination lane`;
    } else {
      hint = "Click a lane to set source, click another to connect";
    }
  } else if (editMode === "draw" && drawSubMode === "road") {
    hint = "Click to place start node, click to add geometry points, double-click to finish edge";
  }

  const stats = network
    ? `J:${network.junctions.size} E:${network.edges.size} C:${network.connections.length}`
    : "No network";

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 h-7 bg-gray-800/95 border-t border-gray-700 flex items-center px-3 text-xs text-gray-400 gap-4 backdrop-blur-sm">
      <span className="text-blue-400 font-semibold uppercase">{editMode}</span>
      <span className="flex-1 truncate">{hint}</span>
      <span className="font-mono">{stats}</span>
      {cursorPosition && (
        <span className="font-mono w-40 text-right">
          {cursorPosition[0].toFixed(5)}, {cursorPosition[1].toFixed(5)}
        </span>
      )}
      <div className="flex gap-1 ml-2">
        <button
          onClick={undo}
          className="px-1.5 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          onClick={redo}
          className="px-1.5 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
          title="Redo (Ctrl+Y)"
        >
          Redo
        </button>
      </div>
    </div>
  );
}

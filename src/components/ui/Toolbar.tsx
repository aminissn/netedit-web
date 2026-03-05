"use client";

import React, { useEffect } from "react";
import { useUIStore, type EditMode } from "@/store/uiStore";

const TOOLS: { mode: EditMode; label: string; key: string; icon: string }[] = [
  { mode: "inspect", label: "Inspect", key: "I", icon: "i" },
  { mode: "select", label: "Select", key: "S", icon: "S" },
  { mode: "move", label: "Move", key: "M", icon: "M" },
  { mode: "createJunction", label: "Create Junction", key: "N", icon: "J" },
  { mode: "createEdge", label: "Create Edge", key: "E", icon: "E" },
  { mode: "delete", label: "Delete", key: "D", icon: "X" },
  { mode: "connection", label: "Connection", key: "C", icon: "C" },
  { mode: "tls", label: "Traffic Light", key: "T", icon: "T" },
];

export default function Toolbar() {
  const editMode = useUIStore((s) => s.editMode);
  const setEditMode = useUIStore((s) => s.setEditMode);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const tool = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (tool) {
        e.preventDefault();
        setEditMode(tool.mode);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setEditMode]);

  return (
    <div className="absolute left-2 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-1 bg-gray-800/90 rounded-lg p-1.5 shadow-lg backdrop-blur-sm">
      {TOOLS.map((tool) => (
        <button
          key={tool.mode}
          onClick={() => setEditMode(tool.mode)}
          className={`w-10 h-10 rounded flex items-center justify-center text-sm font-bold transition-colors
            ${
              editMode === tool.mode
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          title={`${tool.label} (${tool.key})`}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}

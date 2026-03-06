"use client";

import React, { useEffect, useState } from "react";
import { useUIStore, type EditMode, type DrawSubMode } from "@/store/uiStore";

// SVG Icons
const InspectIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

const DrawIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const RoadIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12h18" />
    <path d="M3 6h18" />
    <path d="M3 18h18" />
  </svg>
);

const MergeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M6 21V9a9 9 0 0 0 9 9" />
    <path d="M21 3v6" />
    <path d="M18 6h6" />
  </svg>
);

const TLSIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="2" width="8" height="20" rx="2" />
    <circle cx="12" cy="8" r="1.5" fill="currentColor" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <circle cx="12" cy="16" r="1.5" fill="currentColor" />
  </svg>
);

const TOOLS: { mode: EditMode; label: string; key: string; icon: React.ReactNode }[] = [
  { mode: "inspect", label: "Inspect", key: "I", icon: <InspectIcon /> },
  { mode: "draw", label: "Draw", key: "E", icon: <DrawIcon /> },
  { mode: "tls", label: "Traffic Light", key: "T", icon: <TLSIcon /> },
];

export default function Toolbar() {
  const editMode = useUIStore((s) => s.editMode);
  const drawSubMode = useUIStore((s) => s.drawSubMode);
  const setEditMode = useUIStore((s) => s.setEditMode);
  const setDrawSubMode = useUIStore((s) => s.setDrawSubMode);
  const [showDrawSubModes, setShowDrawSubModes] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        setEditMode("draw");
      } else if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        setEditMode("inspect");
      } else if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        setEditMode("tls");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setEditMode]);

  const handleDrawClick = () => {
    if (editMode === "draw") {
      setShowDrawSubModes(!showDrawSubModes);
    } else {
      setEditMode("draw");
      setShowDrawSubModes(true);
    }
  };

  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-12 z-10 flex flex-row gap-1 bg-gray-800/90 rounded-lg p-1.5 shadow-lg backdrop-blur-sm">
      {TOOLS.map((tool) => (
        <div key={tool.mode} className="relative">
          <button
            onClick={tool.mode === "draw" ? handleDrawClick : () => setEditMode(tool.mode)}
            className={`w-10 h-10 rounded flex items-center justify-center transition-colors
              ${
                editMode === tool.mode
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            title={`${tool.label} (${tool.key})`}
          >
            {tool.icon}
          </button>
          {tool.mode === "draw" && editMode === "draw" && showDrawSubModes && (
            <div className="absolute bottom-full left-0 mb-1 flex flex-col gap-1 bg-gray-800/95 rounded-lg p-1 shadow-lg">
              <button
                onClick={() => {
                  setDrawSubMode("road");
                  setShowDrawSubModes(false);
                }}
                className={`w-10 h-10 rounded flex items-center justify-center transition-colors
                  ${
                    drawSubMode === "road"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                title="Draw Road (Edge)"
              >
                <RoadIcon />
              </button>
              <button
                onClick={() => {
                  setDrawSubMode("connection");
                  setShowDrawSubModes(false);
                }}
                className={`w-10 h-10 rounded flex items-center justify-center transition-colors
                  ${
                    drawSubMode === "connection"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                title="Draw Connection"
              >
                <MergeIcon />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

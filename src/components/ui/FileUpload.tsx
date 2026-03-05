"use client";

import React, { useRef } from "react";
import { useNetworkStore } from "@/store/networkStore";

export default function FileUpload() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadFromXML = useNetworkStore((s) => s.loadFromXML);
  const exportXML = useNetworkStore((s) => s.exportXML);
  const createNew = useNetworkStore((s) => s.createNew);
  const network = useNetworkStore((s) => s.network);

  const handleFileOpen = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) loadFromXML(text);
    };
    reader.readAsText(file);

    // Reset so the same file can be selected again
    e.target.value = "";
  };

  const handleExport = () => {
    const xml = exportXML();
    if (!xml) return;

    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "network.net.xml";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleNew = () => {
    // Create new network at default location (Berlin)
    createNew(13.4, 52.52);
  };

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xml,.net.xml"
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        onClick={handleNew}
        className="px-3 py-1.5 bg-gray-700/90 text-gray-200 rounded-lg text-sm hover:bg-gray-600 backdrop-blur-sm shadow"
      >
        New
      </button>
      <button
        onClick={handleFileOpen}
        className="px-3 py-1.5 bg-gray-700/90 text-gray-200 rounded-lg text-sm hover:bg-gray-600 backdrop-blur-sm shadow"
      >
        Open net.xml
      </button>
      {network && (
        <button
          onClick={handleExport}
          className="px-3 py-1.5 bg-blue-600/90 text-white rounded-lg text-sm hover:bg-blue-500 backdrop-blur-sm shadow"
        >
          Export net.xml
        </button>
      )}
    </div>
  );
}

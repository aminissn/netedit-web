"use client";

import React, { useRef, useState, useEffect } from "react";
import { useNetworkStore } from "@/store/networkStore";

// SVG Icons
const NewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

const OpenIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const ExportIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const ComputeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

export default function FileUpload() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadFromXML = useNetworkStore((s) => s.loadFromXML);
  const exportXML = useNetworkStore((s) => s.exportXML);
  const createNew = useNetworkStore((s) => s.createNew);
  const doComputeNetwork = useNetworkStore((s) => s.doComputeNetwork);
  const isComputing = useNetworkStore((s) => s.isComputing);
  const computeError = useNetworkStore((s) => s.computeError);
  const clearComputeError = useNetworkStore((s) => s.clearComputeError);
  const network = useNetworkStore((s) => s.network);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const errorDetailsRef = useRef<HTMLDivElement>(null);

  // Close error details when clicking outside
  useEffect(() => {
    if (!showErrorDetails) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      if (errorDetailsRef.current && !errorDetailsRef.current.contains(event.target as Node)) {
        setShowErrorDetails(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showErrorDetails]);

  // Close error details when error is cleared
  useEffect(() => {
    if (!computeError) {
      setShowErrorDetails(false);
    }
  }, [computeError]);

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
    <div className="absolute top-2 left-2 z-10 flex gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xml,.net.xml"
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        onClick={handleNew}
        className="w-10 h-10 bg-gray-700/90 text-gray-200 rounded-lg hover:bg-gray-600 backdrop-blur-sm shadow flex items-center justify-center"
        title="Create a new network"
      >
        <NewIcon />
      </button>
      <button
        onClick={handleFileOpen}
        className="w-10 h-10 bg-gray-700/90 text-gray-200 rounded-lg hover:bg-gray-600 backdrop-blur-sm shadow flex items-center justify-center"
        title="Open a network XML file"
      >
        <OpenIcon />
      </button>
      {network && (
        <button
          onClick={handleExport}
          className="w-10 h-10 bg-blue-600/90 text-white rounded-lg hover:bg-blue-500 backdrop-blur-sm shadow flex items-center justify-center"
          title="Export network to XML file"
        >
          <ExportIcon />
        </button>
      )}
      {network && (
        <button
          onClick={() => void doComputeNetwork()}
          disabled={isComputing}
          className="w-10 h-10 bg-emerald-600/90 text-white rounded-lg hover:bg-emerald-500 disabled:bg-emerald-800/80 disabled:text-emerald-200 disabled:cursor-not-allowed backdrop-blur-sm shadow flex items-center justify-center"
          title={isComputing ? "Computing network..." : "Compute network using netconvert"}
        >
          <ComputeIcon />
        </button>
      )}
      {computeError && (
        <div className="relative" ref={errorDetailsRef}>
          <button
            onClick={() => setShowErrorDetails(!showErrorDetails)}
            className="px-3 py-1.5 bg-red-700/90 text-red-100 rounded-lg text-sm hover:bg-red-600 backdrop-blur-sm shadow"
          >
            netconvert error {showErrorDetails ? "▼" : "▶"}
          </button>
          {showErrorDetails && (
            <div className="absolute top-full left-0 mt-2 w-[600px] max-h-[400px] overflow-auto bg-gray-900/95 border border-red-700 rounded-lg p-4 text-xs text-red-100 shadow-xl z-50 backdrop-blur-sm">
              <div className="flex justify-between items-start mb-2">
                <span className="font-semibold text-red-300">Full Error Details:</span>
                <button
                  onClick={clearComputeError}
                  className="px-2 py-1 bg-red-800/80 hover:bg-red-700 rounded text-xs"
                >
                  Close
                </button>
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {computeError}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

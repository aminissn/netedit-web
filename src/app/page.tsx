"use client";

import React, { useEffect } from "react";
import dynamic from "next/dynamic";
import Toolbar from "@/components/ui/Toolbar";
import InspectorPanel from "@/components/ui/InspectorPanel";
import StatusBar from "@/components/ui/StatusBar";
import FileUpload from "@/components/ui/FileUpload";
import { useNetworkStore } from "@/store/networkStore";

const NetworkMap = dynamic(() => import("@/components/map/NetworkMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-900 text-gray-400">
      Loading map...
    </div>
  ),
});

export default function Home() {
  const undo = useNetworkStore((s) => s.undo);
  const redo = useNetworkStore((s) => s.redo);
  const doComputeNetwork = useNetworkStore((s) => s.doComputeNetwork);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        redo();
      }
      // F5 compute removed - compute is now automatic on mode switch
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, doComputeNetwork]);

  return (
    <div className="w-screen h-screen relative overflow-hidden">
      <NetworkMap />
      <FileUpload />
      <Toolbar />
      <InspectorPanel />
      <StatusBar />
    </div>
  );
}

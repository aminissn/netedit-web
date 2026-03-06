import { create } from "zustand";
import { useNetworkStore } from "./networkStore";

export type EditMode =
  | "inspect"
  | "draw"
  | "createEdge"
  | "tls";

export type DrawSubMode = "road" | "connection";

export type ElementType = "junction" | "edge" | "lane" | "connection";

export interface Selection {
  type: ElementType;
  id: string;
  subId?: string; // e.g. lane id within an edge
}

interface UIState {
  editMode: EditMode;
  drawSubMode: DrawSubMode; // Sub-mode for draw: "road" or "connection"
  selection: Selection | null;
  hoverElement: Selection | null;
  cursorPosition: [number, number] | null;

  // Create edge mode state
  createEdgeFromJunction: string | null;

  // Connection mode state
  connectionFromEdge: string | null;
  connectionFromLane: number | null;

  // TLS phase selection: junctionId -> phaseIndex
  selectedTLSPhase: Map<string, number>;

  // Actions
  setEditMode: (mode: EditMode) => void;
  setDrawSubMode: (subMode: DrawSubMode) => void;
  setSelection: (sel: Selection | null) => void;
  setHoverElement: (el: Selection | null) => void;
  setCursorPosition: (pos: [number, number] | null) => void;
  setCreateEdgeFromJunction: (id: string | null) => void;
  setConnectionFrom: (edgeId: string | null, laneIdx: number | null) => void;
  setSelectedTLSPhase: (junctionId: string, phaseIndex: number | null) => void;
  clearModeState: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  editMode: "inspect",
  drawSubMode: "road",
  selection: null,
  hoverElement: null,
  cursorPosition: null,
  createEdgeFromJunction: null,
  connectionFromEdge: null,
  connectionFromLane: null,
  selectedTLSPhase: new Map<string, number>(),

  setEditMode: (mode) => {
    const currentMode = get().editMode;
    // If switching modes and there are dirty changes, trigger compute
    if (currentMode !== mode) {
      const networkStore = useNetworkStore.getState();
      const { dirtyNodes, dirtyEdges, dirtyTLS, resetConnectionEdges, addedConnections, removedConnections, isComputing } = networkStore;
      const hasConnectionChanges = resetConnectionEdges.size > 0 || addedConnections.length > 0 || removedConnections.length > 0;
      const hasDirty = dirtyNodes.size > 0 || dirtyEdges.size > 0 || hasConnectionChanges || dirtyTLS.size > 0;
      
      // Only auto-compute if there are changes and not already computing
      if (hasDirty && !isComputing && networkStore.network) {
        // Trigger compute asynchronously (don't await to avoid blocking mode switch)
        void networkStore.doComputeNetwork();
      }
    }
    
    set({
      editMode: mode,
      selection: null,
      createEdgeFromJunction: null,
      connectionFromEdge: null,
      connectionFromLane: null,
    });
  },

  setDrawSubMode: (subMode) => set({ drawSubMode: subMode }),

  setSelection: (sel) => set({ selection: sel }),
  setHoverElement: (el) => set({ hoverElement: el }),
  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  setCreateEdgeFromJunction: (id) => set({ createEdgeFromJunction: id }),
  setConnectionFrom: (edgeId, laneIdx) =>
    set({ connectionFromEdge: edgeId, connectionFromLane: laneIdx }),
  setSelectedTLSPhase: (junctionId, phaseIndex) => {
    const current = new Map(get().selectedTLSPhase);
    if (phaseIndex === null) {
      current.delete(junctionId);
    } else {
      current.set(junctionId, phaseIndex);
    }
    set({ selectedTLSPhase: current });
  },
  clearModeState: () =>
    set({
      createEdgeFromJunction: null,
      connectionFromEdge: null,
      connectionFromLane: null,
    }),
}));

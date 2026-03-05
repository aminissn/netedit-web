import { create } from "zustand";

export type EditMode =
  | "inspect"
  | "select"
  | "move"
  | "createJunction"
  | "createEdge"
  | "delete"
  | "connection"
  | "tls";

export type ElementType = "junction" | "edge" | "lane" | "connection";

export interface Selection {
  type: ElementType;
  id: string;
  subId?: string; // e.g. lane id within an edge
}

interface UIState {
  editMode: EditMode;
  selection: Selection | null;
  hoverElement: Selection | null;
  cursorPosition: [number, number] | null;

  // Create edge mode state
  createEdgeFromJunction: string | null;

  // Connection mode state
  connectionFromEdge: string | null;
  connectionFromLane: number | null;

  // Actions
  setEditMode: (mode: EditMode) => void;
  setSelection: (sel: Selection | null) => void;
  setHoverElement: (el: Selection | null) => void;
  setCursorPosition: (pos: [number, number] | null) => void;
  setCreateEdgeFromJunction: (id: string | null) => void;
  setConnectionFrom: (edgeId: string | null, laneIdx: number | null) => void;
  clearModeState: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  editMode: "inspect",
  selection: null,
  hoverElement: null,
  cursorPosition: null,
  createEdgeFromJunction: null,
  connectionFromEdge: null,
  connectionFromLane: null,

  setEditMode: (mode) =>
    set({
      editMode: mode,
      selection: null,
      createEdgeFromJunction: null,
      connectionFromEdge: null,
      connectionFromLane: null,
    }),

  setSelection: (sel) => set({ selection: sel }),
  setHoverElement: (el) => set({ hoverElement: el }),
  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  setCreateEdgeFromJunction: (id) => set({ createEdgeFromJunction: id }),
  setConnectionFrom: (edgeId, laneIdx) =>
    set({ connectionFromEdge: edgeId, connectionFromLane: laneIdx }),
  clearModeState: () =>
    set({
      createEdgeFromJunction: null,
      connectionFromEdge: null,
      connectionFromLane: null,
    }),
}));

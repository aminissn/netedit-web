import { create } from "zustand";
import type { SUMONetwork, RenderableNetwork, JunctionType, XY } from "@/lib/sumo/types";
import { parseNetXML } from "@/lib/sumo/parser";
import {
  buildRenderableNetwork,
  addJunction,
  moveJunction,
  removeJunction,
  addEdge,
  removeEdge,
  setEdgeAttribute,
  moveEdgeGeometryPoint,
  addEdgeGeometryPoint,
  removeEdgeGeometryPoint,
  addConnection,
  removeConnection,
  computeNetwork,
  createEmptyNetwork,
} from "@/lib/sumo/network";
import { generateTLSProgram } from "@/lib/sumo/tlsGenerate";
import { exportNetXML } from "@/lib/sumo/exporter";
import { createProjection, type Projection } from "@/lib/sumo/projection";

function deepCloneNetwork(net: SUMONetwork): SUMONetwork {
  return {
    location: { ...net.location },
    junctions: new Map(
      Array.from(net.junctions.entries()).map(([k, v]) => [
        k,
        { ...v, shape: v.shape.map((s) => [...s] as XY), incLanes: [...v.incLanes], intLanes: [...v.intLanes] },
      ])
    ),
    edges: new Map(
      Array.from(net.edges.entries()).map(([k, v]) => [
        k,
        {
          ...v,
          shape: v.shape.map((s) => [...s] as XY),
          lanes: v.lanes.map((l) => ({
            ...l,
            shape: l.shape.map((s) => [...s] as XY),
          })),
        },
      ])
    ),
    connections: net.connections.map((c) => ({ ...c })),
    tlLogics: net.tlLogics.map((tl) => ({
      ...tl,
      phases: tl.phases.map((p) => ({ ...p })),
    })),
    roundabouts: net.roundabouts.map((r) => ({
      nodes: [...r.nodes],
      edges: [...r.edges],
    })),
  };
}

interface NetworkState {
  network: SUMONetwork | null;
  renderable: RenderableNetwork | null;
  projection: Projection | null;
  history: SUMONetwork[];
  historyIndex: number;

  // Actions
  loadFromXML: (xml: string) => void;
  createNew: (lng: number, lat: number) => void;
  rebuild: () => void;
  exportXML: () => string;

  // Mutations (all push to history)
  doAddJunction: (x: number, y: number, type?: JunctionType) => string | null;
  doMoveJunction: (id: string, x: number, y: number) => void;
  doRemoveJunction: (id: string) => void;
  doAddEdge: (fromId: string, toId: string) => string | null;
  doRemoveEdge: (id: string) => void;
  doSetEdgeAttribute: (id: string, attr: string, value: any) => void;
  doMoveGeometryPoint: (edgeId: string, pointIndex: number, pos: XY) => void;
  doAddGeometryPoint: (edgeId: string, afterIndex: number, pos: XY) => void;
  doRemoveGeometryPoint: (edgeId: string, pointIndex: number) => void;
  doAddConnection: (from: string, to: string, fromLane: number, toLane: number) => void;
  doRemoveConnection: (from: string, to: string, fromLane: number, toLane: number) => void;
  doSetJunctionType: (id: string, type: JunctionType) => void;
  doComputeNetwork: () => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const MAX_HISTORY = 50;

export const useNetworkStore = create<NetworkState>((set, get) => {
  function pushHistory() {
    const { network, history, historyIndex } = get();
    if (!network) return;
    const clone = deepCloneNetwork(network);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(clone);
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  }

  function rebuildRenderable() {
    const { network } = get();
    if (!network) {
      set({ renderable: null, projection: null });
      return;
    }
    set({
      renderable: buildRenderableNetwork(network),
      projection: createProjection(network.location),
    });
  }

  function recomputeAndRebuild(network: SUMONetwork): void {
    // Keep the editor loop aligned with netedit/netconvert: mutate -> recompute -> render.
    computeNetwork(network);
    rebuildRenderable();
  }

  return {
    network: null,
    renderable: null,
    projection: null,
    history: [],
    historyIndex: -1,

    loadFromXML: (xml) => {
      const network = parseNetXML(xml);
      const renderable = buildRenderableNetwork(network);
      const projection = createProjection(network.location);
      set({
        network,
        renderable,
        projection,
        history: [deepCloneNetwork(network)],
        historyIndex: 0,
      });
    },

    createNew: (lng, lat) => {
      const network = createEmptyNetwork(lng, lat);
      const renderable = buildRenderableNetwork(network);
      const projection = createProjection(network.location);
      set({
        network,
        renderable,
        projection,
        history: [deepCloneNetwork(network)],
        historyIndex: 0,
      });
    },

    rebuild: () => rebuildRenderable(),

    exportXML: () => {
      const { network } = get();
      if (!network) return "";
      return exportNetXML(network);
    },

    doAddJunction: (x, y, type) => {
      const { network } = get();
      if (!network) return null;
      pushHistory();
      const j = addJunction(network, x, y, type);
      // Adding an isolated junction should not trigger a full-network recompute,
      // otherwise all imported junction polygons get recomputed and may drift.
      rebuildRenderable();
      return j.id;
    },

    doMoveJunction: (id, x, y) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      moveJunction(network, id, x, y);
      recomputeAndRebuild(network);
    },

    doRemoveJunction: (id) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      removeJunction(network, id);
      recomputeAndRebuild(network);
    },

    doAddEdge: (fromId, toId) => {
      const { network } = get();
      if (!network) return null;
      pushHistory();
      const edge = addEdge(network, fromId, toId);
      // Keep imported junction polygons stable: edge creation already updates
      // the new edge and its endpoint junction geometry locally.
      rebuildRenderable();
      return edge?.id ?? null;
    },

    doRemoveEdge: (id) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      removeEdge(network, id);
      recomputeAndRebuild(network);
    },

    doSetEdgeAttribute: (id, attr, value) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      setEdgeAttribute(network, id, attr, value);
      recomputeAndRebuild(network);
    },

    doMoveGeometryPoint: (edgeId, pointIndex, pos) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      moveEdgeGeometryPoint(network, edgeId, pointIndex, pos);
      recomputeAndRebuild(network);
    },

    doAddGeometryPoint: (edgeId, afterIndex, pos) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      addEdgeGeometryPoint(network, edgeId, afterIndex, pos);
      recomputeAndRebuild(network);
    },

    doRemoveGeometryPoint: (edgeId, pointIndex) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      removeEdgeGeometryPoint(network, edgeId, pointIndex);
      recomputeAndRebuild(network);
    },

    doAddConnection: (from, to, fromLane, toLane) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      addConnection(network, from, to, fromLane, toLane);
      rebuildRenderable();
    },

    doRemoveConnection: (from, to, fromLane, toLane) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      removeConnection(network, from, to, fromLane, toLane);
      rebuildRenderable();
    },

    doSetJunctionType: (id, type) => {
      const { network } = get();
      if (!network) return;
      const junction = network.junctions.get(id);
      if (!junction) return;
      pushHistory();

      const oldType = junction.type;
      junction.type = type;

      // If changing to traffic_light, generate a TLS program
      if (type === "traffic_light" && oldType !== "traffic_light") {
        const tls = generateTLSProgram(id, network);
        // Update connections with tl reference
        let linkIdx = 0;
        for (const conn of network.connections) {
          const fromEdge = network.edges.get(conn.from);
          if (fromEdge && fromEdge.to === id) {
            conn.tl = id;
            conn.linkIndex = linkIdx++;
          }
        }
        // Remove any existing TLS for this junction
        network.tlLogics = network.tlLogics.filter((t) => t.id !== id);
        network.tlLogics.push(tls);
      } else if (type !== "traffic_light" && oldType === "traffic_light") {
        // Remove TLS
        network.tlLogics = network.tlLogics.filter((t) => t.id !== id);
        for (const conn of network.connections) {
          if (conn.tl === id) {
            conn.tl = "";
            conn.linkIndex = -1;
          }
        }
      }

      recomputeAndRebuild(network);
    },

    doComputeNetwork: () => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      recomputeAndRebuild(network);
    },

    undo: () => {
      const { history, historyIndex } = get();
      if (historyIndex <= 0) return;
      const newIndex = historyIndex - 1;
      const network = deepCloneNetwork(history[newIndex]);
      set({
        network,
        historyIndex: newIndex,
        renderable: buildRenderableNetwork(network),
        projection: createProjection(network.location),
      });
    },

    redo: () => {
      const { history, historyIndex } = get();
      if (historyIndex >= history.length - 1) return;
      const newIndex = historyIndex + 1;
      const network = deepCloneNetwork(history[newIndex]);
      set({
        network,
        historyIndex: newIndex,
        renderable: buildRenderableNetwork(network),
        projection: createProjection(network.location),
      });
    },

    canUndo: () => get().historyIndex > 0,
    canRedo: () => get().historyIndex < get().history.length - 1,
  };
});

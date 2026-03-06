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
  setLaneAttribute,
  moveEdgeGeometryPoint,
  addEdgeGeometryPoint,
  removeEdgeGeometryPoint,
  addConnection,
  removeConnection,
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
  isComputing: boolean;
  computeError: string | null;

  // Actions
  loadFromXML: (xml: string) => void;
  createNew: (lng: number, lat: number) => void;
  rebuild: () => void;
  exportXML: () => string;
  clearComputeError: () => void;

  // Mutations (all push to history)
  doAddJunction: (x: number, y: number, type?: JunctionType) => string | null;
  doMoveJunction: (id: string, x: number, y: number) => void;
  doRemoveJunction: (id: string) => void;
  doAddEdge: (fromId: string, toId: string) => string | null;
  doDrawEdgeFromJunction: (fromId: string, toPos: XY, via: XY[]) => string | null;
  doRemoveEdge: (id: string) => void;
  doSetEdgeAttribute: (id: string, attr: string, value: any) => void;
  doSetLaneAttribute: (id: string, attr: string, value: any) => void;
  doMoveGeometryPoint: (edgeId: string, pointIndex: number, pos: XY) => void;
  doAddGeometryPoint: (edgeId: string, afterIndex: number, pos: XY) => void;
  doRemoveGeometryPoint: (edgeId: string, pointIndex: number) => void;
  doAddConnection: (from: string, to: string, fromLane: number, toLane: number) => void;
  doRemoveConnection: (from: string, to: string, fromLane: number, toLane: number) => void;
  doSetJunctionType: (id: string, type: JunctionType) => void;
  doSetTLSOffset: (junctionId: string, offset: number) => void;
  doSetTLSPhaseDuration: (junctionId: string, phaseIndex: number, duration: number) => void;
  doSetTLSPhaseState: (junctionId: string, phaseIndex: number, state: string) => void;
  doAddTLSPhase: (junctionId: string) => void;
  doRemoveTLSPhase: (junctionId: string, phaseIndex: number) => void;
  doComputeNetwork: () => Promise<void>;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const MAX_HISTORY = 50;

export const useNetworkStore = create<NetworkState>((set, get) => {
  function setCurrentNetwork(network: SUMONetwork) {
    set({
      network,
      renderable: buildRenderableNetwork(network),
      projection: createProjection(network.location),
    });
  }

  function pushSnapshot(snapshot: SUMONetwork) {
    const { history, historyIndex } = get();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(deepCloneNetwork(snapshot));
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  }

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
    // Keep imported/computed backend junction geometry stable in interactive edits.
    rebuildRenderable();
  }

  function getOrCreateTLS(network: SUMONetwork, junctionId: string) {
    let tls = network.tlLogics.find((t) => t.id === junctionId);
    if (!tls) {
      tls = generateTLSProgram(junctionId, network);
      network.tlLogics.push(tls);
    }
    return tls;
  }

  async function computeViaNetconvert(xml: string): Promise<string> {
    const response = await fetch("/api/netconvert", {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: xml,
    });
    if (!response.ok) {
      let detail = "";
      try {
        const data = await response.json();
        const parts = [
          data?.error,
          data?.details,
          data?.bin ? `bin=${data.bin}` : "",
          Array.isArray(data?.tried) && data.tried.length > 0
            ? `tried=${data.tried.join(", ")}`
            : "",
        ].filter(Boolean);
        detail = parts.join(" | ");
      } catch {
        detail = await response.text();
      }
      throw new Error(detail || `netconvert request failed (${response.status})`);
    }
    return response.text();
  }

  return {
    network: null,
    renderable: null,
    projection: null,
    history: [],
    historyIndex: -1,
    isComputing: false,
    computeError: null,

    loadFromXML: (xml) => {
      const network = parseNetXML(xml);
      set({
        network,
        renderable: buildRenderableNetwork(network),
        projection: createProjection(network.location),
        history: [deepCloneNetwork(network)],
        historyIndex: 0,
        computeError: null,
      });
    },

    createNew: (lng, lat) => {
      const network = createEmptyNetwork(lng, lat);
      set({
        network,
        renderable: buildRenderableNetwork(network),
        projection: createProjection(network.location),
        history: [deepCloneNetwork(network)],
        historyIndex: 0,
        computeError: null,
      });
    },

    rebuild: () => rebuildRenderable(),

    exportXML: () => {
      const { network } = get();
      if (!network) return "";
      return exportNetXML(network);
    },
    clearComputeError: () => set({ computeError: null }),

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
      // Keep imported/computed backend junction polygons stable.
      rebuildRenderable();
      return edge?.id ?? null;
    },

    doDrawEdgeFromJunction: (fromId, toPos, via) => {
      const { network } = get();
      if (!network) return null;
      if (!network.junctions.has(fromId)) return null;
      pushHistory();
      const toJunction = addJunction(network, toPos[0], toPos[1]);
      const edge = addEdge(network, fromId, toJunction.id);
      if (!edge) {
        rebuildRenderable();
        return null;
      }
      via.forEach((pt, idx) => {
        addEdgeGeometryPoint(network, edge.id, idx, pt);
      });
      rebuildRenderable();
      return edge.id;
    },

    doRemoveEdge: (id) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      removeEdge(network, id);
      // Keep junction polygons as imported/computed by backend.
      rebuildRenderable();
    },

    doSetEdgeAttribute: (id, attr, value) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      const edge = network.edges.get(id);
      const oldNumLanes = edge?.numLanes;
      setEdgeAttribute(network, id, attr, value);
      // Edge attribute edits should not trigger TS junction-shape recomputation.
      rebuildRenderable();
      
      // Automatically trigger compute network (F5) when numLanes changes
      if (attr === "numLanes" && oldNumLanes !== undefined && oldNumLanes !== value) {
        get().doComputeNetwork();
      }
    },

    doSetLaneAttribute: (id, attr, value) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      setLaneAttribute(network, id, attr, value);
      rebuildRenderable();
    },

    doMoveGeometryPoint: (edgeId, pointIndex, pos) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      moveEdgeGeometryPoint(network, edgeId, pointIndex, pos);
      rebuildRenderable();
    },

    doAddGeometryPoint: (edgeId, afterIndex, pos) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      addEdgeGeometryPoint(network, edgeId, afterIndex, pos);
      rebuildRenderable();
    },

    doRemoveGeometryPoint: (edgeId, pointIndex) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      removeEdgeGeometryPoint(network, edgeId, pointIndex);
      rebuildRenderable();
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

    doSetTLSOffset: (junctionId, offset) => {
      const { network } = get();
      if (!network) return;
      const junction = network.junctions.get(junctionId);
      if (!junction || junction.type !== "traffic_light") return;
      const tls = network.tlLogics.find((t) => t.id === junctionId);
      if (!tls) return;
      const next = Math.max(0, Math.round(Number(offset) || 0));
      if (next === tls.offset) return;
      pushHistory();
      tls.offset = next;
      rebuildRenderable();
    },

    doSetTLSPhaseDuration: (junctionId, phaseIndex, duration) => {
      const { network } = get();
      if (!network) return;
      const junction = network.junctions.get(junctionId);
      if (!junction || junction.type !== "traffic_light") return;
      const tls = network.tlLogics.find((t) => t.id === junctionId);
      if (!tls) return;
      const phase = tls.phases[phaseIndex];
      if (!phase) return;
      const next = Math.max(1, Math.round(Number(duration) || 0));
      if (next === phase.duration) return;
      pushHistory();
      phase.duration = next;
      if (phase.minDur !== undefined) phase.minDur = Math.min(phase.minDur, next);
      if (phase.maxDur !== undefined) phase.maxDur = Math.max(phase.maxDur, next);
      rebuildRenderable();
    },

    doSetTLSPhaseState: (junctionId, phaseIndex, state) => {
      const { network } = get();
      if (!network) return;
      const junction = network.junctions.get(junctionId);
      if (!junction || junction.type !== "traffic_light") return;
      const tls = network.tlLogics.find((t) => t.id === junctionId);
      if (!tls) return;
      const phase = tls.phases[phaseIndex];
      if (!phase) return;
      const clean = String(state).trim();
      if (!clean) return;
      const expectedLen = phase.state.length;
      const raw =
        clean.length >= expectedLen
          ? clean.slice(0, expectedLen)
          : clean.padEnd(expectedLen, "r");
      const allowed = "rRgGyYsSoOuO";
      const normalized = raw
        .split("")
        .map((c) => (allowed.includes(c) ? c : "r"))
        .join("");
      if (normalized === phase.state) return;
      pushHistory();
      phase.state = normalized;
      rebuildRenderable();
    },

    doAddTLSPhase: (junctionId) => {
      const { network } = get();
      if (!network) return;
      const junction = network.junctions.get(junctionId);
      if (!junction || junction.type !== "traffic_light") return;
      pushHistory();
      const tls = getOrCreateTLS(network, junctionId);
      const templateState = tls.phases[0]?.state ?? "r";
      const allRedState = templateState.replace(/[Ggy]/g, "r");
      tls.phases.push({
        duration: 10,
        state: allRedState,
      });
      rebuildRenderable();
    },

    doRemoveTLSPhase: (junctionId, phaseIndex) => {
      const { network } = get();
      if (!network) return;
      const junction = network.junctions.get(junctionId);
      if (!junction || junction.type !== "traffic_light") return;
      const tls = network.tlLogics.find((t) => t.id === junctionId);
      if (!tls) return;
      if (tls.phases.length <= 1) return;
      if (phaseIndex < 0 || phaseIndex >= tls.phases.length) return;
      pushHistory();
      tls.phases.splice(phaseIndex, 1);
      rebuildRenderable();
    },

    doComputeNetwork: async () => {
      const { network, isComputing } = get();
      if (!network || isComputing) return;
      const snapshot = deepCloneNetwork(network);
      const xml = exportNetXML(snapshot);
      set({ isComputing: true, computeError: null });
      try {
        const computedXml = await computeViaNetconvert(xml);
        const computedNetwork = parseNetXML(computedXml);
        pushSnapshot(snapshot);
        setCurrentNetwork(computedNetwork);
        set({ isComputing: false, computeError: null });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Failed to compute network via netconvert.";
        set({ isComputing: false, computeError: message });
      }
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

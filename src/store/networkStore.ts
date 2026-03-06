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
import {
  exportNetXML,
  exportPatchNodXML,
  exportPatchEdgXML,
  exportPatchConXML,
  exportPatchTllXML,
} from "@/lib/sumo/exporter";
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

  /** The last-computed (or initially-loaded) net.xml, used as base for patch-mode netconvert. */
  baseNetXML: string | null;
  /** Accumulated patch files that persist across multiple compute operations */
  accumulatedPatches: {
    nodXML: string | null;
    edgXML: string | null;
    conXML: string | null;
    tllXML: string | null;
  };
  /** Element IDs that changed since the last compute / load. */
  dirtyNodes: Set<string>;
  dirtyEdges: Set<string>;
  dirtyTLS: Set<string>;
  /** Edges whose numLanes changed — emit reset directives in con.xml */
  resetConnectionEdges: Set<string>;
  /** Connections that existed before numLanes change (for writing to con.xml) */
  resetConnectionSnapshots: Map<string, { from: string; to: string }[]>;
  /** Individually added connections */
  addedConnections: { from: string; to: string; fromLane: number; toLane: number }[];
  /** Individually removed connections */
  removedConnections: { from: string; to: string; fromLane: number; toLane: number }[];

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

  function clearDirty() {
    set({
      dirtyNodes: new Set<string>(),
      dirtyEdges: new Set<string>(),
      dirtyTLS: new Set<string>(),
      resetConnectionEdges: new Set<string>(),
      resetConnectionSnapshots: new Map<string, { from: string; to: string }[]>(),
      addedConnections: [],
      removedConnections: [],
    });
  }

  function markDirtyNode(id: string) {
    get().dirtyNodes.add(id);
  }

  function markDirtyEdge(id: string) {
    get().dirtyEdges.add(id);
  }

  function markDirtyTLS(id: string) {
    get().dirtyTLS.add(id);
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

  async function computeViaNetconvert(payload: {
    baseNetXML: string;
    nodXML?: string;
    edgXML?: string;
    conXML?: string;
    tllXML?: string;
  }): Promise<string> {
    const hasPatchFiles = !!(payload.nodXML || payload.edgXML || payload.conXML || payload.tllXML);

    let response: Response;
    if (hasPatchFiles) {
      // Patch mode: send JSON with base + patch files
      response = await fetch("/api/netconvert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      // Full mode: send plain XML
      response = await fetch("/api/netconvert", {
        method: "POST",
        headers: { "Content-Type": "application/xml" },
        body: payload.baseNetXML,
      });
    }

    if (!response.ok) {
      let detail = "";
      try {
        const data = await response.json();
        // Build comprehensive error message with all available details
        const parts: string[] = [];
        
        if (data?.error) parts.push(`ERROR: ${data.error}`);
        if (data?.details) parts.push(`\nDETAILS:\n${data.details}`);
        if (data?.stderr) parts.push(`\nSTDERR:\n${data.stderr}`);
        if (data?.stdout) parts.push(`\nSTDOUT:\n${data.stdout}`);
        if (data?.bin) parts.push(`\nBinary: ${data.bin}`);
        if (data?.exitCode !== undefined) parts.push(`\nExit code: ${data.exitCode}`);
        if (Array.isArray(data?.tried) && data.tried.length > 0) {
          parts.push(`\nTried binaries: ${data.tried.join(", ")}`);
        }
        
        detail = parts.length > 0 ? parts.join("\n") : `netconvert request failed (${response.status})`;
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
    baseNetXML: null,
    accumulatedPatches: {
      nodXML: null,
      edgXML: null,
      conXML: null,
      tllXML: null,
    },
    dirtyNodes: new Set<string>(),
    dirtyEdges: new Set<string>(),
    dirtyTLS: new Set<string>(),
    resetConnectionEdges: new Set<string>(),
    resetConnectionSnapshots: new Map<string, { from: string; to: string }[]>(),
    addedConnections: [],
    removedConnections: [],

    loadFromXML: (xml) => {
      const network = parseNetXML(xml);
      set({
        network,
        renderable: buildRenderableNetwork(network),
        projection: createProjection(network.location),
        history: [deepCloneNetwork(network)],
        historyIndex: 0,
        computeError: null,
        baseNetXML: xml,
        accumulatedPatches: {
          nodXML: null,
          edgXML: null,
          conXML: null,
          tllXML: null,
        },
      });
      clearDirty();
    },

    createNew: (lng, lat) => {
      const network = createEmptyNetwork(lng, lat);
      const xml = exportNetXML(network);
      set({
        network,
        renderable: buildRenderableNetwork(network),
        projection: createProjection(network.location),
        history: [deepCloneNetwork(network)],
        historyIndex: 0,
        computeError: null,
        baseNetXML: xml,
        accumulatedPatches: {
          nodXML: null,
          edgXML: null,
          conXML: null,
          tllXML: null,
        },
      });
      clearDirty();
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
      markDirtyNode(j.id);
      rebuildRenderable();
      return j.id;
    },

    doMoveJunction: (id, x, y) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      moveJunction(network, id, x, y);
      markDirtyNode(id);
      // Also mark edges connected to this junction
      network.edges.forEach((edge) => {
        if (edge.from === id || edge.to === id) markDirtyEdge(edge.id);
      });
      recomputeAndRebuild(network);
    },

    doRemoveJunction: (id) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      // Mark connected edges as dirty before removal
      network.edges.forEach((edge) => {
        if (edge.from === id || edge.to === id) markDirtyEdge(edge.id);
      });
      markDirtyNode(id);

      removeJunction(network, id);
      recomputeAndRebuild(network);
    },

    doAddEdge: (fromId, toId) => {
      const { network } = get();
      if (!network) return null;
      pushHistory();
      const edge = addEdge(network, fromId, toId);
      if (edge) {
        markDirtyEdge(edge.id);
        markDirtyNode(fromId);
        markDirtyNode(toId);
  
      }
      rebuildRenderable();
      return edge?.id ?? null;
    },

    doDrawEdgeFromJunction: (fromId, toPos, via) => {
      const { network } = get();
      if (!network) return null;
      if (!network.junctions.has(fromId)) return null;
      pushHistory();
      const toJunction = addJunction(network, toPos[0], toPos[1]);
      markDirtyNode(toJunction.id);
      const edge = addEdge(network, fromId, toJunction.id);
      if (!edge) {
        rebuildRenderable();
        return null;
      }
      via.forEach((pt, idx) => {
        addEdgeGeometryPoint(network, edge.id, idx, pt);
      });
      markDirtyEdge(edge.id);
      markDirtyNode(fromId);

      rebuildRenderable();
      return edge.id;
    },

    doRemoveEdge: (id) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      const edge = network.edges.get(id);
      if (edge) {
        markDirtyNode(edge.from);
        markDirtyNode(edge.to);
      }
      markDirtyEdge(id);

      removeEdge(network, id);
      rebuildRenderable();
    },

    doSetEdgeAttribute: (id, attr, value) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      const edge = network.edges.get(id);
      const oldNumLanes = edge?.numLanes;
      
      // If numLanes is changing, capture connections before they're removed
      if (attr === "numLanes" && oldNumLanes !== undefined && oldNumLanes !== value) {
        const connectionsToCapture: { from: string; to: string }[] = [];
        for (const conn of network.connections) {
          if (conn.from === id || conn.to === id) {
            connectionsToCapture.push({ from: conn.from, to: conn.to });
          }
        }
        if (connectionsToCapture.length > 0) {
          const snapshots = new Map(get().resetConnectionSnapshots);
          snapshots.set(id, connectionsToCapture);
          set({ resetConnectionSnapshots: snapshots });
        }
        get().resetConnectionEdges.add(id);
      }
      
      setEdgeAttribute(network, id, attr, value);
      markDirtyEdge(id);
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
      // Find edge owning this lane
      network.edges.forEach((edge) => {
        if (edge.lanes.some((l) => l.id === id)) markDirtyEdge(edge.id);
      });
      rebuildRenderable();
    },

    doMoveGeometryPoint: (edgeId, pointIndex, pos) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      moveEdgeGeometryPoint(network, edgeId, pointIndex, pos);
      markDirtyEdge(edgeId);
      rebuildRenderable();
    },

    doAddGeometryPoint: (edgeId, afterIndex, pos) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      addEdgeGeometryPoint(network, edgeId, afterIndex, pos);
      markDirtyEdge(edgeId);
      rebuildRenderable();
    },

    doRemoveGeometryPoint: (edgeId, pointIndex) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      removeEdgeGeometryPoint(network, edgeId, pointIndex);
      markDirtyEdge(edgeId);
      rebuildRenderable();
    },

    doAddConnection: (from, to, fromLane, toLane) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      addConnection(network, from, to, fromLane, toLane);
      get().addedConnections.push({ from, to, fromLane, toLane });
      rebuildRenderable();
    },

    doRemoveConnection: (from, to, fromLane, toLane) => {
      const { network } = get();
      if (!network) return;
      pushHistory();
      removeConnection(network, from, to, fromLane, toLane);
      get().removedConnections.push({ from, to, fromLane, toLane });
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
      markDirtyNode(id);

      // If changing to traffic_light, generate a TLS program
      if (type === "traffic_light" && oldType !== "traffic_light") {
        const tls = generateTLSProgram(id, network);
        let linkIdx = 0;
        for (const conn of network.connections) {
          const fromEdge = network.edges.get(conn.from);
          if (fromEdge && fromEdge.to === id) {
            conn.tl = id;
            conn.linkIndex = linkIdx++;
          }
        }
        network.tlLogics = network.tlLogics.filter((t) => t.id !== id);
        network.tlLogics.push(tls);
        markDirtyTLS(id);
  
      } else if (type !== "traffic_light" && oldType === "traffic_light") {
        network.tlLogics = network.tlLogics.filter((t) => t.id !== id);
        for (const conn of network.connections) {
          if (conn.tl === id) {
            conn.tl = "";
            conn.linkIndex = -1;
          }
        }
        markDirtyTLS(id);
  
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
      markDirtyTLS(junctionId);
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
      markDirtyTLS(junctionId);
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
      markDirtyTLS(junctionId);
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
      markDirtyTLS(junctionId);
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
      markDirtyTLS(junctionId);
      rebuildRenderable();
    },

    doComputeNetwork: async () => {
      const { network, isComputing, baseNetXML, accumulatedPatches, dirtyNodes, dirtyEdges, dirtyTLS, resetConnectionEdges, resetConnectionSnapshots, addedConnections, removedConnections } = get();
      if (!network || isComputing) return;
      const snapshot = deepCloneNetwork(network);
      set({ isComputing: true, computeError: null });

      try {
        const hasConnectionChanges = resetConnectionEdges.size > 0 || addedConnections.length > 0 || removedConnections.length > 0;
        const hasDirty = dirtyNodes.size > 0 || dirtyEdges.size > 0 || hasConnectionChanges || dirtyTLS.size > 0;
        let payload: {
          baseNetXML: string;
          nodXML?: string;
          edgXML?: string;
          conXML?: string;
          tllXML?: string;
        };
        let newPatches = { ...accumulatedPatches };

        if (baseNetXML) {
          // Always use the original uploaded file as base when it exists
          if (hasDirty) {
            // Patch mode: send original base + only changed elements (merged with existing patches)
            payload = { baseNetXML };
            const nodPatch = exportPatchNodXML(network, dirtyNodes, accumulatedPatches.nodXML);
            const edgPatch = exportPatchEdgXML(network, dirtyEdges, accumulatedPatches.edgXML);
            const tllPatch = exportPatchTllXML(network, dirtyTLS, accumulatedPatches.tllXML);
            if (nodPatch) {
              payload.nodXML = nodPatch;
              newPatches.nodXML = nodPatch;
            }
            if (edgPatch) {
              payload.edgXML = edgPatch;
              newPatches.edgXML = edgPatch;
            }
            if (hasConnectionChanges) {
              const conPatch = exportPatchConXML(resetConnectionEdges, resetConnectionSnapshots, addedConnections, removedConnections, network, accumulatedPatches.conXML);
              payload.conXML = conPatch;
              newPatches.conXML = conPatch;
            }
            if (tllPatch) {
              payload.tllXML = tllPatch;
              newPatches.tllXML = tllPatch;
            }
          } else {
            // No changes: just use the original base file (no patches)
            payload = { baseNetXML };
          }
        } else {
          // Full mode: no original base (new network) — send full network
          payload = { baseNetXML: exportNetXML(snapshot) };
          // Reset patches for new network
          newPatches = {
            nodXML: null,
            edgXML: null,
            conXML: null,
            tllXML: null,
          };
        }

        const computedXml = await computeViaNetconvert(payload);
        const computedNetwork = parseNetXML(computedXml);
        pushSnapshot(snapshot);
        setCurrentNetwork(computedNetwork);
        // Keep baseNetXML unchanged - it should always be the original uploaded file
        // Update accumulated patches for next compute
        set({ isComputing: false, computeError: null, accumulatedPatches: newPatches });
        clearDirty();
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

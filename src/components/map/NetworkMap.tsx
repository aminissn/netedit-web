"use client";

import React, { useCallback, useMemo, useRef, useEffect } from "react";
import { Map } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { MapViewState, PickingInfo } from "@deck.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";

import { useNetworkStore } from "@/store/networkStore";
import { useUIStore } from "@/store/uiStore";
import { COLORS, type RGBA } from "@/lib/sumo/colors";
import type {
  RenderableJunction,
  RenderableConnection,
  XY,
} from "@/lib/sumo/types";

type DeckPath = [number, number][];

const MAP_STYLE = "https://tiles.openfreemap.org/styles/bright";

const INITIAL_VIEW: MapViewState = {
  longitude: 13.4,
  latitude: 52.52,
  zoom: 14,
  pitch: 0,
  bearing: 0,
};

export default function NetworkMap() {
  const renderable = useNetworkStore((s) => s.renderable);
  const network = useNetworkStore((s) => s.network);
  const projection = useNetworkStore((s) => s.projection);
  const store = useNetworkStore;

  const editMode = useUIStore((s) => s.editMode);
  const selection = useUIStore((s) => s.selection);
  const hoverElement = useUIStore((s) => s.hoverElement);
  const createEdgeFromJunction = useUIStore((s) => s.createEdgeFromJunction);
  const connectionFromEdge = useUIStore((s) => s.connectionFromEdge);
  const connectionFromLane = useUIStore((s) => s.connectionFromLane);
  const cursorPosition = useUIStore((s) => s.cursorPosition);
  const selectedTLSPhase = useUIStore((s) => s.selectedTLSPhase);
  const setSelection = useUIStore((s) => s.setSelection);
  const setHoverElement = useUIStore((s) => s.setHoverElement);
  const setCursorPosition = useUIStore((s) => s.setCursorPosition);
  const setCreateEdgeFromJunction = useUIStore((s) => s.setCreateEdgeFromJunction);
  const setConnectionFrom = useUIStore((s) => s.setConnectionFrom);
  const setEditMode = useUIStore((s) => s.setEditMode);

  const [viewState, setViewState] = React.useState<MapViewState>(INITIAL_VIEW);
  const dragRef = useRef<{ edgeId: string; pointIndex: number } | null>(null);
  const drawClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [drawDraft, setDrawDraft] = React.useState<{
    startJunctionId: string;
    startPos: XY;
    via: XY[];
  } | null>(null);
  const lastClickTimeRef = useRef<number>(0);
  const lastClickCoordRef = useRef<[number, number] | null>(null);
  const lastClickJunctionIdRef = useRef<string | undefined>(undefined);

  // Center map on network when loaded
  useEffect(() => {
    if (renderable) {
      setViewState((prev: MapViewState) => ({
        ...prev,
        longitude: renderable.center[0],
        latitude: renderable.center[1],
        zoom: renderable.zoom,
      }));
    }
  }, [renderable?.center[0], renderable?.center[1]]);

  useEffect(() => {
    if (editMode !== "draw") {
      setDrawDraft(null);
      if (drawClickTimerRef.current) {
        clearTimeout(drawClickTimerRef.current);
        drawClickTimerRef.current = null;
      }
    }
  }, [editMode]);

  useEffect(() => {
    return () => {
      if (drawClickTimerRef.current) {
        clearTimeout(drawClickTimerRef.current);
      }
    };
  }, []);

  // ─── Layers ───

  const lanePaths = useMemo(() => {
    if (!renderable) return [];
    return renderable.edges.flatMap((e) =>
      e.lanes.map((lane) => ({
        ...lane,
        edgeId: e.id,
      }))
    );
  }, [renderable]);

  const laneLayer = useMemo(
    () =>
      new PathLayer({
        id: "lanes",
        data: lanePaths,
        getPath: (d: any) => d.path as unknown as DeckPath,
        getWidth: (d: any) => d.width,
        getColor: (d: any) => {
          if (selection?.type === "lane" && selection.id === d.id)
            return COLORS.laneSelected;
          if (selection?.type === "edge" && selection.id === d.edgeId)
            return COLORS.laneSelected;
          if (hoverElement?.type === "lane" && hoverElement.id === d.id)
            return COLORS.laneHover;
          if (hoverElement?.type === "edge" && hoverElement.id === d.edgeId)
            return COLORS.laneHover;
          if (editMode === "delete" && hoverElement?.id === d.id)
            return COLORS.deleteHighlight;
          return COLORS.lane;
        },
        widthUnits: "meters" as const,
        widthMinPixels: 2,
        pickable: true,
        jointRounded: true,
        capRounded: true,
        updateTriggers: {
          getColor: [selection, hoverElement, editMode],
        },
      }),
    [lanePaths, selection, hoverElement, editMode]
  );

  const junctionLayer = useMemo(
    () =>
      new PolygonLayer({
        id: "junctions",
        data: renderable?.junctions ?? [],
        getPolygon: (d: RenderableJunction) =>
          d.polygon as unknown as DeckPath,
        getFillColor: (d: RenderableJunction) => {
          if (selection?.type === "junction" && selection.id === d.id)
            return COLORS.junctionSelected;
          if (hoverElement?.type === "junction" && hoverElement.id === d.id)
            return COLORS.junctionHover;
          if (d.type === "traffic_light") return COLORS.trafficLight;
          if (editMode === "delete" && hoverElement?.type === "junction" && hoverElement.id === d.id)
            return COLORS.deleteHighlight;
          return COLORS.junction;
        },
        getLineColor: [30, 30, 30, 200] as any,
        getLineWidth: 0.5,
        lineWidthUnits: "meters" as const,
        lineWidthMinPixels: 1,
        pickable: true,
        updateTriggers: {
          getFillColor: [selection, hoverElement, editMode],
        },
      }),
    [renderable?.junctions, selection, hoverElement, editMode]
  );

  // Helper function to get connection color based on selected TLS phase
  const getConnectionColor = useCallback(
    (conn: RenderableConnection): RGBA => {
      const isSelected =
        selection?.type === "connection" &&
        selection.id === `${conn.from}_${conn.fromLane}-${conn.to}_${conn.toLane}`;
      if (isSelected) return COLORS.connectionSelected;

      // If connection has a traffic light and a phase is selected, color by phase state
      if (conn.tl && network) {
        const phaseIndex = selectedTLSPhase.get(conn.tl);
        if (phaseIndex !== undefined) {
          const tls = network.tlLogics.find((t) => t.id === conn.tl);
          if (tls && tls.phases[phaseIndex] && conn.linkIndex >= 0) {
            const phaseState = tls.phases[phaseIndex].state;
            const stateChar = phaseState[conn.linkIndex];
            if (stateChar) {
              // Color based on state: G/g = green, y = yellow, r/s = red, o/O = orange
              if (stateChar === "G" || stateChar === "g") return COLORS.tlsGreen;
              if (stateChar === "y") return COLORS.tlsYellow;
              if (stateChar === "r" || stateChar === "s") return COLORS.tlsRed;
              if (stateChar === "o" || stateChar === "O") return [255, 165, 0, 255] as RGBA;
            }
          }
        }
      }

      return COLORS.connection;
    },
    [selection, network, selectedTLSPhase]
  );

  const connectionLayer = useMemo(
    () =>
      new PathLayer({
        id: "connections",
        data: renderable?.connections ?? [],
        getPath: (d: RenderableConnection) => d.path as unknown as DeckPath,
        getWidth: 1.2,
        getColor: (d: RenderableConnection) => getConnectionColor(d) as any,
        widthUnits: "meters" as const,
        widthMinPixels: 1,
        pickable: editMode === "connection" || editMode === "inspect" || editMode === "tls" || editMode === "delete",
        visible: editMode === "connection" || editMode === "inspect" || editMode === "tls" || editMode === "delete",
        getDashArray: [4, 2],
        dashJustified: true,
        updateTriggers: {
          getColor: [selection, selectedTLSPhase],
        },
      }),
    [renderable?.connections, selection, editMode, getConnectionColor, selectedTLSPhase]
  );

  // Geometry points for selected edge (in move mode)
  const geometryPoints = useMemo(() => {
    if (editMode !== "move" || !selection || selection.type !== "edge" || !network || !projection)
      return [];
    const edge = network.edges.get(selection.id);
    if (!edge) return [];
    return edge.shape.map((pt, i) => ({
      position: projection.sumoToLngLat(pt),
      index: i,
      edgeId: edge.id,
    }));
  }, [editMode, selection, network, projection]);

  const geometryPointLayer = useMemo(
    () =>
      new ScatterplotLayer({
        id: "geometry-points",
        data: geometryPoints,
        getPosition: (d: any) => d.position,
        getRadius: 4,
        getFillColor: COLORS.geometryPoint as any,
        radiusUnits: "meters" as const,
        radiusMinPixels: 5,
        pickable: true,
      }),
    [geometryPoints]
  );

  // Helper function to calculate the geometric midpoint along a polyline path
  const getPathMidpoint = useCallback((path: [number, number][]): [number, number] => {
    if (path.length === 0) return [0, 0];
    if (path.length === 1) return path[0];
    if (path.length === 2) {
      // Simple midpoint between two points
      return [
        (path[0][0] + path[1][0]) / 2,
        (path[0][1] + path[1][1]) / 2,
      ];
    }

    // Calculate cumulative distances along the path
    const distances: number[] = [0];
    let totalDistance = 0;
    for (let i = 1; i < path.length; i++) {
      const dx = path[i][0] - path[i - 1][0];
      const dy = path[i][1] - path[i - 1][1];
      const segmentLength = Math.sqrt(dx * dx + dy * dy);
      totalDistance += segmentLength;
      distances.push(totalDistance);
    }

    // Find the midpoint (half the total distance)
    const targetDistance = totalDistance / 2;
    
    // Find which segment contains the midpoint
    for (let i = 1; i < distances.length; i++) {
      if (distances[i] >= targetDistance) {
        // Interpolate within this segment
        const segmentStart = distances[i - 1];
        const segmentLength = distances[i] - segmentStart;
        const t = (targetDistance - segmentStart) / segmentLength;
        
        return [
          path[i - 1][0] + t * (path[i][0] - path[i - 1][0]),
          path[i - 1][1] + t * (path[i][1] - path[i - 1][1]),
        ];
      }
    }

    // Fallback to last point
    return path[path.length - 1];
  }, []);

  // Connection linkIndex labels (only show in TLS mode)
  const connectionLabels = useMemo(() => {
    if (editMode !== "tls" || !renderable?.connections) return [];
    return renderable.connections
      .filter((conn) => conn.tl && conn.linkIndex >= 0 && conn.path.length > 0)
      .map((conn) => {
        // Calculate geometric midpoint of connection path
        const position = getPathMidpoint(conn.path as [number, number][]);
        return {
          position,
          text: conn.linkIndex.toString(),
          linkIndex: conn.linkIndex,
          tl: conn.tl,
        };
      });
  }, [renderable?.connections, editMode, getPathMidpoint]);

  const connectionLabelLayer = useMemo(
    () =>
      new TextLayer({
        id: "connection-labels",
        data: connectionLabels,
        getPosition: (d: any) => d.position,
        getText: (d: any) => d.text,
        getColor: [255, 255, 255, 255] as any,
        getSize: 12,
        getAngle: 0,
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        fontFamily: "monospace",
        fontWeight: "bold",
        sizeScale: 1,
        sizeMinPixels: 10,
        sizeMaxPixels: 20,
        pickable: false,
        visible: editMode === "tls",
      }),
    [connectionLabels, editMode]
  );

  const drawPreviewPath = useMemo(() => {
    if (editMode !== "draw" || !drawDraft || !projection) return [];
    const shape: XY[] = [drawDraft.startPos, ...drawDraft.via];
    if (cursorPosition) {
      shape.push(projection.lngLatToSumo(cursorPosition));
    }
    if (shape.length < 2) return [];
    return [{ path: projection.sumoShapeToLngLat(shape) }];
  }, [editMode, drawDraft, projection, cursorPosition]);

  const drawPreviewLayer = useMemo(
    () =>
      new PathLayer({
        id: "draw-preview",
        data: drawPreviewPath,
        getPath: (d: any) => d.path as unknown as DeckPath,
        getWidth: 1.2,
        getColor: [255, 165, 0, 220],
        widthUnits: "meters" as const,
        widthMinPixels: 3,
        capRounded: true,
        jointRounded: true,
        pickable: false,
        visible: editMode === "draw",
      }),
    [drawPreviewPath, editMode]
  );

  const drawVertexLayer = useMemo(() => {
    if (editMode !== "draw" || !drawDraft || !projection) {
      return new ScatterplotLayer({
        id: "draw-vertices",
        data: [],
        visible: false,
      });
    }
    const points = [drawDraft.startPos, ...drawDraft.via].map((pt, i) => ({
      position: projection.sumoToLngLat(pt),
      isStart: i === 0,
    }));
    return new ScatterplotLayer({
      id: "draw-vertices",
      data: points,
      getPosition: (d: any) => d.position,
      getRadius: (d: any) => (d.isStart ? 5 : 3.5),
      getFillColor: (d: any) => (d.isStart ? [59, 130, 246, 220] : [251, 191, 36, 220]),
      radiusUnits: "meters" as const,
      radiusMinPixels: 5,
      pickable: false,
      visible: true,
    });
  }, [editMode, drawDraft, projection]);

  const layers = [
    laneLayer,
    junctionLayer,
    connectionLayer,
    connectionLabelLayer,
    geometryPointLayer,
    drawPreviewLayer,
    drawVertexLayer,
  ];

  // ─── Interaction handlers ───

  const handleDrawSingleClick = useCallback(
    (coordinate: [number, number], clickedJunctionId?: string) => {
      let activeProjection = projection;
      if (!network || !activeProjection) {
        store.getState().createNew(coordinate[0], coordinate[1]);
        const st = store.getState();
        activeProjection = st.projection;
      }
      if (!activeProjection) return;
      const sumoPos = activeProjection.lngLatToSumo([coordinate[0], coordinate[1]]);

      if (!drawDraft) {
        // Starting a new edge
        let startId: string | null = null;
        let startPos: XY;
        
        if (clickedJunctionId) {
          // Use existing junction
          const junction = network?.junctions.get(clickedJunctionId);
          if (junction) {
            startId = clickedJunctionId;
            startPos = [junction.x, junction.y];
          }
        }
        
        if (!startId) {
          // Create new junction
          startId = store.getState().doAddJunction(sumoPos[0], sumoPos[1]);
          if (!startId) return;
          startPos = sumoPos;
        }
        
        setDrawDraft({
          startJunctionId: startId,
          startPos,
          via: [],
        });
        setSelection({ type: "junction", id: startId });
        return;
      }

      // Adding a geometry point (via point)
      setDrawDraft((prev) =>
        prev
          ? {
              ...prev,
              via: [...prev.via, sumoPos],
            }
          : prev
      );
    },
    [network, projection, drawDraft, setSelection]
  );

  const finalizeDraw = useCallback(
    (coordinate: [number, number], clickedJunctionId?: string) => {
      if (!drawDraft) return;
      const activeProjection = projection ?? store.getState().projection;
      if (!activeProjection) return;
      const st = store.getState();
      
      let edgeId: string | null = null;
      
      if (clickedJunctionId && network) {
        // Ending on an existing junction - use doAddEdge
        edgeId = st.doAddEdge(drawDraft.startJunctionId, clickedJunctionId);
        // If there are via points, we need to update the edge geometry
        if (edgeId && drawDraft.via.length > 0 && network) {
          const edge = network.edges.get(edgeId);
          if (edge) {
            // Add via points as geometry points
            drawDraft.via.forEach((viaPoint, idx) => {
              st.doAddGeometryPoint(edgeId!, idx, viaPoint);
            });
          }
        }
      } else {
        // Ending at a new location - create new junction and edge
        const endPos = activeProjection.lngLatToSumo([coordinate[0], coordinate[1]]);
        edgeId = st.doDrawEdgeFromJunction(drawDraft.startJunctionId, endPos, drawDraft.via);
      }
      
      if (edgeId) {
        setSelection({ type: "edge", id: edgeId });
        // Automatically trigger compute network (F5) after drawing finishes
        st.doComputeNetwork();
      }
      setDrawDraft(null);
      // Exit draw mode after finalizing the edge
      setEditMode("inspect");
    },
    [drawDraft, projection, network, setSelection, setEditMode]
  );

  const handleClick = useCallback(
    (info: PickingInfo) => {
      const { coordinate } = info;
      if (!coordinate) return;

      if (editMode === "draw") {
        const clickCoord: [number, number] = [coordinate[0], coordinate[1]];
        // Check if user clicked on an existing junction
        const clickedJunctionId = info.layer?.id === "junctions" 
          ? (info.object as any)?.id 
          : undefined;
        
        const now = Date.now();
        const timeSinceLastClick = now - lastClickTimeRef.current;
        const lastCoord = lastClickCoordRef.current;
        const lastJunctionId = lastClickJunctionIdRef.current;
        
        // Check if this is a double-click (within 300ms and similar position)
        const isDoubleClick = 
          timeSinceLastClick < 300 &&
          lastCoord &&
          Math.abs(clickCoord[0] - lastCoord[0]) < 0.0001 &&
          Math.abs(clickCoord[1] - lastCoord[1]) < 0.0001 &&
          clickedJunctionId === lastJunctionId; // Same junction or both empty space
        
        if (isDoubleClick) {
          // Clear any pending single-click timer
          if (drawClickTimerRef.current) {
            clearTimeout(drawClickTimerRef.current);
            drawClickTimerRef.current = null;
          }
          // Reset click tracking
          lastClickTimeRef.current = 0;
          lastClickCoordRef.current = null;
          lastClickJunctionIdRef.current = undefined;
          // Handle as double-click: finalize the draw
          finalizeDraw(clickCoord, clickedJunctionId);
          return;
        }
        
        // Store this click for potential double-click detection
        lastClickTimeRef.current = now;
        lastClickCoordRef.current = clickCoord;
        lastClickJunctionIdRef.current = clickedJunctionId;
        
        // Set timer for single-click (longer delay to allow double-click detection)
        if (drawClickTimerRef.current) {
          clearTimeout(drawClickTimerRef.current);
        }
        drawClickTimerRef.current = setTimeout(() => {
          handleDrawSingleClick(clickCoord, clickedJunctionId);
          drawClickTimerRef.current = null;
          lastClickTimeRef.current = 0;
          lastClickCoordRef.current = null;
          lastClickJunctionIdRef.current = undefined;
        }, 300);
        return;
      }

      // Auto-create a network if none exists and user is in a creation mode
      if (!network || !projection) {
        if (editMode === "createJunction" || editMode === "createEdge") {
          store.getState().createNew(coordinate[0], coordinate[1]);
          // After creating, add junction at clicked location
          const st = store.getState();
          if (st.projection) {
            const pos = st.projection.lngLatToSumo([coordinate[0], coordinate[1]]);
            st.doAddJunction(pos[0], pos[1]);
          }
        }
        return;
      }

      const sumoPos = projection.lngLatToSumo([coordinate[0], coordinate[1]]);

      switch (editMode) {
        case "inspect":
        case "select": {
          if (info.layer?.id === "junctions") {
            setSelection({ type: "junction", id: (info.object as any).id });
          } else if (info.layer?.id === "lanes") {
            const obj = info.object as any;
            setSelection({ type: "lane", id: obj.id, subId: obj.edgeId });
          } else if (info.layer?.id === "connections") {
            const obj = info.object as RenderableConnection;
            setSelection({
              type: "connection",
              id: `${obj.from}_${obj.fromLane}-${obj.to}_${obj.toLane}`,
            });
          } else {
            setSelection(null);
          }
          break;
        }

        case "createJunction": {
          store.getState().doAddJunction(sumoPos[0], sumoPos[1]);
          break;
        }

        case "createEdge": {
          if (info.layer?.id === "junctions") {
            const juncId = (info.object as any).id;
            if (!createEdgeFromJunction) {
              setCreateEdgeFromJunction(juncId);
            } else if (juncId !== createEdgeFromJunction) {
              store.getState().doAddEdge(createEdgeFromJunction, juncId);
              setCreateEdgeFromJunction(null);
            }
          } else {
            setCreateEdgeFromJunction(null);
          }
          break;
        }

        case "delete": {
          if (info.layer?.id === "junctions") {
            store.getState().doRemoveJunction((info.object as any).id);
          } else if (info.layer?.id === "lanes") {
            store.getState().doRemoveEdge((info.object as any).edgeId);
          } else if (info.layer?.id === "connections") {
            const obj = info.object as RenderableConnection;
            store.getState().doRemoveConnection(obj.from, obj.to, obj.fromLane, obj.toLane);
          }
          setSelection(null);
          break;
        }

        case "connection": {
          if (info.layer?.id === "lanes") {
            const obj = info.object as any;
            if (!connectionFromEdge) {
              setConnectionFrom(obj.edgeId, obj.index);
            } else {
              store.getState().doAddConnection(
                connectionFromEdge,
                obj.edgeId,
                connectionFromLane!,
                obj.index
              );
              setConnectionFrom(null, null);
            }
          } else {
            setConnectionFrom(null, null);
          }
          break;
        }

        case "move": {
          if (info.layer?.id === "junctions") {
            setSelection({ type: "junction", id: (info.object as any).id });
          } else if (info.layer?.id === "lanes") {
            const obj = info.object as any;
            setSelection({ type: "edge", id: obj.edgeId });
          } else {
            setSelection(null);
          }
          break;
        }

        case "tls": {
          if (info.layer?.id === "junctions") {
            setSelection({ type: "junction", id: (info.object as any).id });
          }
          break;
        }
      }
    },
    [
      editMode,
      projection,
      network,
      createEdgeFromJunction,
      connectionFromEdge,
      connectionFromLane,
      setSelection,
      setCreateEdgeFromJunction,
      setConnectionFrom,
      handleDrawSingleClick,
      finalizeDraw,
    ]
  );

  const handleMapDblClick = useCallback(
    (evt: any) => {
      if (editMode !== "draw") return;
      evt?.preventDefault?.();
      // Clear any pending single-click timer
      if (drawClickTimerRef.current) {
        clearTimeout(drawClickTimerRef.current);
        drawClickTimerRef.current = null;
      }
      // Reset click tracking
      lastClickTimeRef.current = 0;
      lastClickCoordRef.current = null;
      
      const lng = evt?.lngLat?.lng;
      const lat = evt?.lngLat?.lat;
      if (typeof lng !== "number" || typeof lat !== "number") return;
      finalizeDraw([lng, lat]);
    },
    [editMode, finalizeDraw]
  );

  const handleHover = useCallback(
    (info: PickingInfo) => {
      if (info.coordinate) {
        setCursorPosition([info.coordinate[0], info.coordinate[1]]);
      }
      if (info.layer?.id === "junctions" && info.object) {
        setHoverElement({ type: "junction", id: (info.object as any).id });
      } else if (info.layer?.id === "lanes" && info.object) {
        const obj = info.object as any;
        setHoverElement({ type: "lane", id: obj.id });
      } else {
        setHoverElement(null);
      }
    },
    [setHoverElement, setCursorPosition]
  );

  const handleDragStart = useCallback(
    (info: PickingInfo) => {
      if (editMode !== "move" || !info.object) return;

      if (info.layer?.id === "geometry-points") {
        const obj = info.object as any;
        dragRef.current = { edgeId: obj.edgeId, pointIndex: obj.index };
        return;
      }
    },
    [editMode]
  );

  const handleDrag = useCallback(
    (info: PickingInfo) => {
      if (!info.coordinate || !projection) return;

      const sumoPos = projection.lngLatToSumo([info.coordinate[0], info.coordinate[1]]);

      if (editMode === "move") {
        if (dragRef.current) {
          store.getState().doMoveGeometryPoint(
            dragRef.current.edgeId,
            dragRef.current.pointIndex,
            sumoPos
          );
        } else if (selection?.type === "junction") {
          store.getState().doMoveJunction(selection.id, sumoPos[0], sumoPos[1]);
        }
      }
    },
    [editMode, selection, projection]
  );

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  const getCursor = useCallback(
    ({ isDragging }: { isDragging: boolean }) => {
      if (isDragging) return "grabbing";
      switch (editMode) {
        case "createJunction":
          return "crosshair";
        case "draw":
          return "crosshair";
        case "createEdge":
          return createEdgeFromJunction ? "crosshair" : "pointer";
        case "delete":
          return "pointer";
        case "move":
          return "grab";
        case "connection":
          return connectionFromEdge ? "crosshair" : "pointer";
        default:
          return "default";
      }
    },
    [editMode, createEdgeFromJunction, connectionFromEdge]
  );

  return (
    <DeckGL
      viewState={viewState}
      onViewStateChange={({ viewState: vs }: { viewState: MapViewState }) => setViewState(vs)}
      controller={{
        dragPan: editMode !== "move" || (!selection && !dragRef.current),
        doubleClickZoom: editMode !== "draw",
      }}
      layers={layers}
      onClick={handleClick}
      onHover={handleHover}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      getCursor={getCursor}
      pickingRadius={5}
    >
      <Map mapStyle={MAP_STYLE} onDblClick={handleMapDblClick} />
    </DeckGL>
  );
}

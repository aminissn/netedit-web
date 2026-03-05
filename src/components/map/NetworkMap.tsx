"use client";

import React, { useCallback, useMemo, useRef, useEffect } from "react";
import { Map } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { PathLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { MapViewState, PickingInfo } from "@deck.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";

import { useNetworkStore } from "@/store/networkStore";
import { useUIStore } from "@/store/uiStore";
import { COLORS } from "@/lib/sumo/colors";
import type {
  RenderableJunction,
  RenderableConnection,
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
  const setSelection = useUIStore((s) => s.setSelection);
  const setHoverElement = useUIStore((s) => s.setHoverElement);
  const setCursorPosition = useUIStore((s) => s.setCursorPosition);
  const setCreateEdgeFromJunction = useUIStore((s) => s.setCreateEdgeFromJunction);
  const setConnectionFrom = useUIStore((s) => s.setConnectionFrom);

  const [viewState, setViewState] = React.useState<MapViewState>(INITIAL_VIEW);
  const dragRef = useRef<{ edgeId: string; pointIndex: number } | null>(null);

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

  const connectionLayer = useMemo(
    () =>
      new PathLayer({
        id: "connections",
        data: renderable?.connections ?? [],
        getPath: (d: RenderableConnection) => d.path as unknown as DeckPath,
        getWidth: 0.8,
        getColor: (d: RenderableConnection) => {
          const isSelected =
            selection?.type === "connection" &&
            selection.id === `${d.from}_${d.fromLane}-${d.to}_${d.toLane}`;
          if (isSelected) return COLORS.connectionSelected;
          return COLORS.connection;
        },
        widthUnits: "meters" as const,
        widthMinPixels: 1,
        pickable: editMode === "connection" || editMode === "inspect",
        visible: editMode === "connection" || editMode === "inspect" || editMode === "tls",
        getDashArray: [4, 2],
        dashJustified: true,
        updateTriggers: {
          getColor: [selection],
        },
      }),
    [renderable?.connections, selection, editMode]
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

  const layers = [laneLayer, junctionLayer, connectionLayer, geometryPointLayer];

  // ─── Interaction handlers ───

  const handleClick = useCallback(
    (info: PickingInfo) => {
      const { coordinate } = info;
      if (!coordinate) return;

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
            setSelection({ type: "edge", id: obj.edgeId, subId: obj.id });
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
    ]
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
      controller={{ dragPan: editMode !== "move" || (!selection && !dragRef.current) }}
      layers={layers}
      onClick={handleClick}
      onHover={handleHover}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      getCursor={getCursor}
      pickingRadius={5}
    >
      <Map mapStyle={MAP_STYLE} />
    </DeckGL>
  );
}

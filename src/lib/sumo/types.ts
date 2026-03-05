/** 2D coordinate in SUMO's projected coordinate system */
export type XY = [number, number];

/** WGS84 [longitude, latitude] */
export type LngLat = [number, number];

export interface SUMOLocation {
  netOffset: XY;
  convBoundary: [number, number, number, number];
  origBoundary: [number, number, number, number];
  projParameter: string;
}

export type JunctionType =
  | "priority"
  | "traffic_light"
  | "right_before_left"
  | "unregulated"
  | "dead_end"
  | "allway_stop"
  | "priority_stop"
  | "traffic_light_unregulated"
  | "traffic_light_right_on_red"
  | "zipper"
  | "rail_signal"
  | "rail_crossing"
  | "internal";

export interface SUMOJunction {
  id: string;
  type: JunctionType;
  x: number;
  y: number;
  z: number;
  incLanes: string[];
  intLanes: string[];
  shape: XY[];
  customShape: boolean;
}

export type SpreadType = "right" | "center" | "roadCenter";

export interface SUMOEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  priority: number;
  numLanes: number;
  speed: number;
  spreadType: SpreadType;
  shape: XY[];
  lanes: SUMOLane[];
  allow: string;
  disallow: string;
  width: number;
}

export interface SUMOLane {
  id: string;
  index: number;
  speed: number;
  length: number;
  width: number;
  allow: string;
  disallow: string;
  shape: XY[];
}

export interface SUMOConnection {
  from: string;
  to: string;
  fromLane: number;
  toLane: number;
  via: string;
  tl: string;
  linkIndex: number;
  dir: string;
  state: string;
}

export type TLSType = "static" | "actuated" | "delay_based";

export interface TLSPhase {
  duration: number;
  state: string;
  minDur?: number;
  maxDur?: number;
}

export interface SUMOTLLogic {
  id: string;
  type: TLSType;
  programID: string;
  offset: number;
  phases: TLSPhase[];
}

export interface SUMONetwork {
  location: SUMOLocation;
  junctions: Map<string, SUMOJunction>;
  edges: Map<string, SUMOEdge>;
  connections: SUMOConnection[];
  tlLogics: SUMOTLLogic[];
  roundabouts: { nodes: string[]; edges: string[] }[];
}

/** Renderable versions with WGS84 coordinates for deck.gl */
export interface RenderableEdge {
  id: string;
  from: string;
  to: string;
  lanes: RenderableLane[];
  centerLine: LngLat[];
}

export interface RenderableLane {
  id: string;
  index: number;
  path: LngLat[];
  width: number;
  allow: string;
  disallow: string;
}

export interface RenderableJunction {
  id: string;
  type: JunctionType;
  position: LngLat;
  polygon: LngLat[];
}

export interface RenderableConnection {
  from: string;
  to: string;
  fromLane: number;
  toLane: number;
  path: LngLat[];
  tl: string;
  linkIndex: number;
}

export interface RenderableNetwork {
  edges: RenderableEdge[];
  junctions: RenderableJunction[];
  connections: RenderableConnection[];
  center: LngLat;
  zoom: number;
}

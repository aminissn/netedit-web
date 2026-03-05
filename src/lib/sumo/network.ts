/**
 * Pure mutation helpers for the SUMO network + buildRenderableNetwork.
 * All functions are pure: they return new state or mutate in-place as documented.
 */
import type {
  SUMONetwork,
  SUMOJunction,
  SUMOEdge,
  SUMOLane,
  SUMOConnection,
  RenderableNetwork,
  RenderableEdge,
  RenderableLane,
  RenderableJunction,
  RenderableConnection,
  XY,
  LngLat,
  JunctionType,
  SpreadType,
} from "./types";
import proj4 from "proj4";
import { createProjection, type Projection } from "./projection";
import {
  dist,
  add,
  sub,
  scale,
  normalize,
  perpRight,
  offsetPolyline,
  polylineLength,
  SUMO_DEFAULT_LANE_WIDTH,
  interpolatePolyline,
} from "./geometry";
import { computeNodeShape, computeSetback, trimPolylineStart, trimPolylineEnd } from "./nodeShape";

let idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}_${++idCounter}`;
}

// ─── Junction mutations ───

export function addJunction(
  network: SUMONetwork,
  x: number,
  y: number,
  type: JunctionType = "priority"
): SUMOJunction {
  const id = nextId("J");
  const junction: SUMOJunction = {
    id,
    type,
    x,
    y,
    z: 0,
    incLanes: [],
    intLanes: [],
    shape: [],
    customShape: false,
  };
  // Compute a small default shape
  const s = 2;
  junction.shape = [
    [x - s, y - s],
    [x + s, y - s],
    [x + s, y + s],
    [x - s, y + s],
  ];
  network.junctions.set(id, junction);
  return junction;
}

export function moveJunction(
  network: SUMONetwork,
  junctionId: string,
  newX: number,
  newY: number
): void {
  const junction = network.junctions.get(junctionId);
  if (!junction) return;

  const dx = newX - junction.x;
  const dy = newY - junction.y;

  junction.x = newX;
  junction.y = newY;

  // Move shape with the junction
  junction.shape = junction.shape.map(([sx, sy]) => [sx + dx, sy + dy] as XY);

  // Update connected edge endpoints
  network.edges.forEach((edge) => {
    if (edge.from === junctionId && edge.shape.length > 0) {
      edge.shape[0] = [edge.shape[0][0] + dx, edge.shape[0][1] + dy];
      recomputeLaneShapes(edge);
    }
    if (edge.to === junctionId && edge.shape.length > 0) {
      const last = edge.shape.length - 1;
      edge.shape[last] = [edge.shape[last][0] + dx, edge.shape[last][1] + dy];
      recomputeLaneShapes(edge);
    }
  });

  // Recompute junction shape
  junction.shape = computeNodeShape(junction, network.edges);
}

export function removeJunction(network: SUMONetwork, junctionId: string): void {
  network.junctions.delete(junctionId);
  // Remove all edges connected to this junction
  const edgesToRemove: string[] = [];
  network.edges.forEach((edge) => {
    if (edge.from === junctionId || edge.to === junctionId) {
      edgesToRemove.push(edge.id);
    }
  });
  for (const id of edgesToRemove) {
    removeEdge(network, id);
  }
}

// ─── Edge mutations ───

export function addEdge(
  network: SUMONetwork,
  fromId: string,
  toId: string,
  numLanes = 1,
  speed = 13.89
): SUMOEdge | null {
  const fromJunction = network.junctions.get(fromId);
  const toJunction = network.junctions.get(toId);
  if (!fromJunction || !toJunction) return null;

  const id = nextId("E");
  const shape: XY[] = [
    [fromJunction.x, fromJunction.y],
    [toJunction.x, toJunction.y],
  ];

  const lanes: SUMOLane[] = [];
  for (let i = 0; i < numLanes; i++) {
    const laneShape = computeLaneShape(shape, i, numLanes, "right");
    lanes.push({
      id: `${id}_${i}`,
      index: i,
      speed,
      length: polylineLength(laneShape),
      width: SUMO_DEFAULT_LANE_WIDTH,
      allow: "",
      disallow: "",
      shape: laneShape,
    });
  }

  const edge: SUMOEdge = {
    id,
    from: fromId,
    to: toId,
    type: "",
    priority: -1,
    numLanes,
    speed,
    spreadType: "right",
    shape,
    lanes,
    allow: "",
    disallow: "",
    width: SUMO_DEFAULT_LANE_WIDTH,
  };

  network.edges.set(id, edge);

  // Recompute junction shapes for connected junctions
  fromJunction.shape = computeNodeShape(fromJunction, network.edges);
  toJunction.shape = computeNodeShape(toJunction, network.edges);

  // Guess connections
  guessConnectionsForEdge(network, edge);

  return edge;
}

export function removeEdge(network: SUMONetwork, edgeId: string): void {
  network.edges.delete(edgeId);
  // Remove related connections
  network.connections = network.connections.filter(
    (c) => c.from !== edgeId && c.to !== edgeId
  );
}

export function setEdgeAttribute(
  network: SUMONetwork,
  edgeId: string,
  attr: string,
  value: any
): void {
  const edge = network.edges.get(edgeId);
  if (!edge) return;

  switch (attr) {
    case "numLanes": {
      const newNum = Math.max(1, Math.min(10, Number(value)));
      if (newNum === edge.numLanes) return;
      edge.numLanes = newNum;
      // Rebuild lanes
      edge.lanes = [];
      for (let i = 0; i < newNum; i++) {
        const laneShape = computeLaneShape(edge.shape, i, newNum, edge.spreadType);
        edge.lanes.push({
          id: `${edgeId}_${i}`,
          index: i,
          speed: edge.speed,
          length: polylineLength(laneShape),
          width: SUMO_DEFAULT_LANE_WIDTH,
          allow: "",
          disallow: "",
          shape: laneShape,
        });
      }
      // Re-guess connections
      network.connections = network.connections.filter(
        (c) => c.from !== edgeId && c.to !== edgeId
      );
      guessConnectionsForEdge(network, edge);
      // Recompute junction shapes
      const fromJ = network.junctions.get(edge.from);
      const toJ = network.junctions.get(edge.to);
      if (fromJ) fromJ.shape = computeNodeShape(fromJ, network.edges);
      if (toJ) toJ.shape = computeNodeShape(toJ, network.edges);
      break;
    }
    case "speed":
      edge.speed = Number(value);
      edge.lanes.forEach((l) => (l.speed = edge.speed));
      break;
    case "priority":
      edge.priority = Number(value);
      break;
    case "allow":
      edge.allow = String(value);
      break;
    case "disallow":
      edge.disallow = String(value);
      break;
    case "type":
      edge.type = String(value);
      break;
    case "spreadType":
      edge.spreadType = "right";
      recomputeLaneShapes(edge);
      {
        const fromJ = network.junctions.get(edge.from);
        const toJ = network.junctions.get(edge.to);
        if (fromJ) fromJ.shape = computeNodeShape(fromJ, network.edges);
        if (toJ) toJ.shape = computeNodeShape(toJ, network.edges);
      }
      break;
  }
}

export function moveEdgeGeometryPoint(
  network: SUMONetwork,
  edgeId: string,
  pointIndex: number,
  newPos: XY
): void {
  const edge = network.edges.get(edgeId);
  if (!edge || pointIndex < 0 || pointIndex >= edge.shape.length) return;
  edge.shape[pointIndex] = newPos;
  recomputeLaneShapes(edge);
}

export function addEdgeGeometryPoint(
  network: SUMONetwork,
  edgeId: string,
  afterIndex: number,
  pos: XY
): void {
  const edge = network.edges.get(edgeId);
  if (!edge) return;
  edge.shape.splice(afterIndex + 1, 0, pos);
  recomputeLaneShapes(edge);
}

export function removeEdgeGeometryPoint(
  network: SUMONetwork,
  edgeId: string,
  pointIndex: number
): void {
  const edge = network.edges.get(edgeId);
  if (!edge || edge.shape.length <= 2) return; // Must keep at least 2 points
  if (pointIndex <= 0 || pointIndex >= edge.shape.length - 1) return; // Don't remove endpoints
  edge.shape.splice(pointIndex, 1);
  recomputeLaneShapes(edge);
}

// ─── Connection mutations ───

export function addConnection(
  network: SUMONetwork,
  from: string,
  to: string,
  fromLane: number,
  toLane: number
): void {
  // Check if connection already exists
  const exists = network.connections.some(
    (c) => c.from === from && c.to === to && c.fromLane === fromLane && c.toLane === toLane
  );
  if (exists) return;

  network.connections.push({
    from,
    to,
    fromLane,
    toLane,
    via: "",
    tl: "",
    linkIndex: -1,
    dir: "s",
    state: "M",
  });
}

export function removeConnection(
  network: SUMONetwork,
  from: string,
  to: string,
  fromLane: number,
  toLane: number
): void {
  network.connections = network.connections.filter(
    (c) => !(c.from === from && c.to === to && c.fromLane === fromLane && c.toLane === toLane)
  );
}

// ─── Internal helpers ───

function computeLaneShape(
  edgeShape: XY[],
  laneIndex: number,
  numLanes: number,
  spreadType: SpreadType
): XY[] {
  const laneWidth = SUMO_DEFAULT_LANE_WIDTH;

  let offset: number;
  if (spreadType === "right") {
    // Lane 0 is rightmost, offset from right side of road
    offset = -(laneIndex + 0.5) * laneWidth;
  } else if (spreadType === "center") {
    // Lanes spread symmetrically
    offset = (laneIndex - (numLanes - 1) / 2) * laneWidth;
  } else {
    // roadCenter: like center but the road center stays fixed
    offset = (laneIndex - (numLanes - 1) / 2) * laneWidth;
  }

  return offsetPolyline(edgeShape, offset);
}

function recomputeLaneShapes(edge: SUMOEdge): void {
  for (const lane of edge.lanes) {
    lane.shape = computeLaneShape(edge.shape, lane.index, edge.numLanes, edge.spreadType);
    lane.length = polylineLength(lane.shape);
  }
}

function guessConnectionsForEdge(network: SUMONetwork, edge: SUMOEdge): void {
  // Find outgoing edges from the 'to' junction
  const toJunction = network.junctions.get(edge.to);
  if (!toJunction) return;

  const outEdges: SUMOEdge[] = [];
  network.edges.forEach((e) => {
    if (e.from === edge.to && e.id !== edge.id) {
      outEdges.push(e);
    }
  });

  if (outEdges.length === 0) return;

  // Simple connection guessing: connect each incoming lane to each outgoing edge
  // For each outgoing edge, connect from the most appropriate lane
  for (const outEdge of outEdges) {
    const maxFromLane = edge.numLanes - 1;
    const maxToLane = outEdge.numLanes - 1;

    // Connect at least from lane 0 to lane 0
    addConnection(network, edge.id, outEdge.id, 0, 0);

    // If multiple lanes, also connect higher lanes
    if (edge.numLanes > 1 && outEdge.numLanes > 1) {
      const lanes = Math.min(edge.numLanes, outEdge.numLanes);
      for (let i = 1; i < lanes; i++) {
        addConnection(network, edge.id, outEdge.id, i, Math.min(i, maxToLane));
      }
    }
  }
}

// ─── Edge trimming for rendering ───

/**
 * Return a trimmed copy of the edge shape so it stops at junction boundaries
 * instead of extending to junction centers. Does NOT mutate the original edge.
 */
function getTrimmedEdgeShape(
  edge: SUMOEdge,
  junctions: Map<string, SUMOJunction>,
  allEdges: Map<string, SUMOEdge>
): XY[] {
  if (edge.shape.length < 2) return edge.shape;

  let shape = [...edge.shape.map((p) => [...p] as XY)];

  const fromJ = junctions.get(edge.from);
  const toJ = junctions.get(edge.to);

  const fromSetback = fromJ ? computeSetback(fromJ, edge, allEdges) : 0;
  const toSetback = toJ ? computeSetback(toJ, edge, allEdges) : 0;

  if (fromSetback > 0) {
    shape = trimPolylineStart(shape, fromSetback);
  }
  if (toSetback > 0) {
    shape = trimPolylineEnd(shape, toSetback);
  }

  return shape;
}

// ─── Build renderable network ───

export function buildRenderableNetwork(network: SUMONetwork): RenderableNetwork {
  const proj = createProjection(network.location);

  // Pre-compute trimmed lane shapes for all edges (used for both rendering and connections)
  const trimmedLaneShapes = new Map<string, XY[]>();
  const trimmedEdgeShapes = new Map<string, XY[]>();
  network.edges.forEach((edge) => {
    const trimmedShape = getTrimmedEdgeShape(edge, network.junctions, network.edges);
    trimmedEdgeShapes.set(edge.id, trimmedShape);
    for (const lane of edge.lanes) {
      const trimmedLaneShape = computeLaneShape(trimmedShape, lane.index, edge.numLanes, edge.spreadType);
      trimmedLaneShapes.set(lane.id, trimmedLaneShape);
    }
  });

  const edges: RenderableEdge[] = [];
  network.edges.forEach((edge) => {
    const trimmedShape = trimmedEdgeShapes.get(edge.id)!;

    const lanes: RenderableLane[] = edge.lanes.map((lane) => ({
      id: lane.id,
      index: lane.index,
      path: proj.sumoShapeToLngLat(trimmedLaneShapes.get(lane.id)!),
      width: lane.width,
      allow: lane.allow,
      disallow: lane.disallow,
    }));

    edges.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      lanes,
      centerLine: proj.sumoShapeToLngLat(trimmedShape),
    });
  });

  const junctions: RenderableJunction[] = [];
  network.junctions.forEach((junc) => {
    if (junc.type === "internal") return;
    junctions.push({
      id: junc.id,
      type: junc.type,
      position: proj.sumoToLngLat([junc.x, junc.y]),
      polygon: proj.sumoShapeToLngLat(junc.shape),
    });
  });

  const connections: RenderableConnection[] = [];
  for (const conn of network.connections) {
    const fromEdge = network.edges.get(conn.from);
    const toEdge = network.edges.get(conn.to);
    if (!fromEdge || !toEdge) continue;

    const fromLane = fromEdge.lanes[conn.fromLane];
    const toLane = toEdge.lanes[conn.toLane];
    if (!fromLane || !toLane) continue;

    const fromLaneShape = trimmedLaneShapes.get(fromLane.id) ?? fromLane.shape;
    const toLaneShape = trimmedLaneShapes.get(toLane.id) ?? toLane.shape;
    const fromEnd = fromLaneShape[fromLaneShape.length - 1];
    const toStart = toLaneShape[0];

    connections.push({
      from: conn.from,
      to: conn.to,
      fromLane: conn.fromLane,
      toLane: conn.toLane,
      path: proj.sumoShapeToLngLat([fromEnd, toStart]),
      tl: conn.tl,
      linkIndex: conn.linkIndex,
    });
  }

  // Compute center and zoom from boundary
  const { convBoundary } = network.location;
  const centerSumo: XY = [
    (convBoundary[0] + convBoundary[2]) / 2,
    (convBoundary[1] + convBoundary[3]) / 2,
  ];
  const center = proj.sumoToLngLat(centerSumo);

  // Estimate zoom from boundary size
  const bWidth = convBoundary[2] - convBoundary[0];
  const bHeight = convBoundary[3] - convBoundary[1];
  const maxDim = Math.max(bWidth, bHeight);
  const zoom = maxDim > 0 ? Math.max(10, Math.min(18, 16 - Math.log2(maxDim / 100))) : 15;

  return { edges, junctions, connections, center, zoom };
}

/**
 * Recompute the full network geometry (equivalent to netconvert's computeNetwork).
 * Updates lane shapes, junction shapes, and connections.
 */
export function computeNetwork(network: SUMONetwork): void {
  // 1. Recompute lane shapes for all edges
  network.edges.forEach((edge) => {
    recomputeLaneShapes(edge);
  });

  // 2. Recompute all junction shapes
  network.junctions.forEach((junction) => {
    if (junction.type === "internal") return;
    junction.shape = computeNodeShape(junction, network.edges);
  });
}

/**
 * Create an empty network centered at a given lon/lat.
 */
export function createEmptyNetwork(centerLng: number, centerLat: number): SUMONetwork {
  const projParameter = `+proj=utm +zone=${Math.floor((centerLng + 180) / 6) + 1} +ellps=WGS84 +datum=WGS84 +units=m +no_defs`;

  // SUMO convention: net = proj + offset, so proj = net - offset
  // We want net(0,0) → proj = utmCenter → geo = center
  // So: 0 - offset = utmCenter → offset = -utmCenter
  const converter = proj4(projParameter, "WGS84");
  const [utmX, utmY] = converter.inverse([centerLng, centerLat]);
  const netOffset: XY = [-utmX, -utmY];

  return {
    location: {
      netOffset,
      convBoundary: [-500, -500, 500, 500],
      origBoundary: [centerLng - 0.01, centerLat - 0.01, centerLng + 0.01, centerLat + 0.01],
      projParameter,
    },
    junctions: new Map(),
    edges: new Map(),
    connections: [],
    tlLogics: [],
    roundabouts: [],
  };
}

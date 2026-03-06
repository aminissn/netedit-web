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
  cross,
  dot,
  bezierCurve,
  endDirection,
  startDirection,
} from "./geometry";
import {
  computeNodeShape,
  computeSetback,
  trimPolylineStart,
  trimPolylineEnd,
} from "./nodeShape";
import { generateTLSProgram } from "./tlsGenerate";

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
      recomputeLaneShapes(edge, network);
    }
    if (edge.to === junctionId && edge.shape.length > 0) {
      const last = edge.shape.length - 1;
      edge.shape[last] = [edge.shape[last][0] + dx, edge.shape[last][1] + dy];
      recomputeLaneShapes(edge, network);
    }
  });

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
    lanes.push({
      id: `${id}_${i}`,
      index: i,
      speed,
      length: 0, // Will be set by recomputeLaneShapes
      width: SUMO_DEFAULT_LANE_WIDTH,
      allow: "",
      disallow: "",
      shape: [], // Will be set by recomputeLaneShapes
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

  // Recompute lane shapes with proper endpoint snapping to junction centers
  recomputeLaneShapes(edge, network);

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
        edge.lanes.push({
          id: `${edgeId}_${i}`,
          index: i,
          speed: edge.speed,
          length: 0, // Will be set by recomputeLaneShapes
          width: SUMO_DEFAULT_LANE_WIDTH,
          allow: "",
          disallow: "",
          shape: [], // Will be set by recomputeLaneShapes
        });
      }
      // Recompute lane shapes with proper endpoint snapping
      recomputeLaneShapes(edge, network);
      // Re-guess connections
      network.connections = network.connections.filter(
        (c) => c.from !== edgeId && c.to !== edgeId
      );
      guessConnectionsForEdge(network, edge);
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
      recomputeLaneShapes(edge, network);
      break;
  }
}

export function setLaneAttribute(
  network: SUMONetwork,
  laneId: string,
  attr: string,
  value: any
): void {
  let targetLane: SUMOLane | undefined;
  for (const edge of Array.from(network.edges.values())) {
    const lane = edge.lanes.find((l) => l.id === laneId);
    if (lane) {
      targetLane = lane;
      break;
    }
  }
  if (!targetLane) return;

  switch (attr) {
    case "speed": {
      const speed = Number(value);
      if (Number.isFinite(speed) && speed > 0) {
        targetLane.speed = speed;
      }
      break;
    }
    case "width": {
      const width = Number(value);
      if (Number.isFinite(width) && width > 0) {
        targetLane.width = width;
      }
      break;
    }
    case "allow":
      targetLane.allow = String(value);
      break;
    case "disallow":
      targetLane.disallow = String(value);
      break;
    default:
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
  recomputeLaneShapes(edge, network);
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
  recomputeLaneShapes(edge, network);
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
  recomputeLaneShapes(edge, network);
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
  const offset = getLaneOffsetFromCenter(laneIndex, numLanes, spreadType, laneWidth);

  return offsetPolyline(edgeShape, offset);
}

function getLaneOffsetFromCenter(
  laneIndex: number,
  numLanes: number,
  spreadType: SpreadType,
  laneWidth: number
): number {
  if (spreadType === "right") {
    // In SUMO, lane 0 is rightmost in travel direction.
    return (laneIndex + 0.5) * laneWidth;
  }
  return (laneIndex - (numLanes - 1) / 2) * laneWidth;
}

function recomputeLaneShapes(edge: SUMOEdge, network?: SUMONetwork): void {
  for (const lane of edge.lanes) {
    lane.shape = computeLaneShape(edge.shape, lane.index, edge.numLanes, edge.spreadType);
    
    // Ensure lane shape endpoints are exactly at junction centers
    // This is critical for accurate node shape computation
    if (network) {
      const fromJ = network.junctions.get(edge.from);
      const toJ = network.junctions.get(edge.to);
      
      if (fromJ && lane.shape.length > 0) {
        // Snap first point to junction center (perpendicular offset from center)
        // Compute edge direction at start - use second point if available, otherwise use direction to end
        let edgeDir: XY;
        if (edge.shape.length >= 2 && dist(edge.shape[0], edge.shape[1]) > 0.01) {
          edgeDir = normalize(sub(edge.shape[1], edge.shape[0]));
        } else if (edge.shape.length >= 2) {
          // Edge goes from junction to junction - use direction to end junction
          edgeDir = normalize(sub([toJ?.x || edge.shape[edge.shape.length - 1][0], toJ?.y || edge.shape[edge.shape.length - 1][1]], [fromJ.x, fromJ.y]));
        } else {
          // Fallback: use lane shape direction
          if (lane.shape.length >= 2) {
            edgeDir = normalize(sub(lane.shape[1], lane.shape[0]));
          } else {
            edgeDir = [1, 0]; // Default direction
          }
        }
        const right = perpRight(edgeDir);
        const laneWidth = SUMO_DEFAULT_LANE_WIDTH;
        const offset = getLaneOffsetFromCenter(
          lane.index,
          edge.numLanes,
          edge.spreadType,
          laneWidth
        );
        lane.shape[0] = add([fromJ.x, fromJ.y], scale(right, offset));
      }
      
      if (toJ && lane.shape.length > 0) {
        // Snap last point to junction center (perpendicular offset from center)
        const lastIdx = edge.shape.length - 1;
        // Compute edge direction at end - use second-to-last point if available
        let edgeDir: XY;
        if (edge.shape.length >= 2 && dist(edge.shape[lastIdx - 1], edge.shape[lastIdx]) > 0.01) {
          edgeDir = normalize(sub(edge.shape[lastIdx], edge.shape[lastIdx - 1]));
        } else if (edge.shape.length >= 2) {
          // Edge goes from junction to junction - use direction from start junction
          edgeDir = normalize(sub([toJ.x, toJ.y], [fromJ?.x || edge.shape[0][0], fromJ?.y || edge.shape[0][1]]));
        } else {
          // Fallback: use lane shape direction
          if (lane.shape.length >= 2) {
            const lastLaneIdx = lane.shape.length - 1;
            edgeDir = normalize(sub(lane.shape[lastLaneIdx], lane.shape[lastLaneIdx - 1]));
          } else {
            edgeDir = [1, 0]; // Default direction
          }
        }
        const right = perpRight(edgeDir);
        const laneWidth = SUMO_DEFAULT_LANE_WIDTH;
        const offset = getLaneOffsetFromCenter(
          lane.index,
          edge.numLanes,
          edge.spreadType,
          laneWidth
        );
        const lastLaneIdx = lane.shape.length - 1;
        lane.shape[lastLaneIdx] = add([toJ.x, toJ.y], scale(right, offset));
      }
    }
    
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

    // Get directions at the end of fromLane and start of toLane
    const fromDir = endDirection(fromLaneShape);
    const toDir = startDirection(toLaneShape);
    
    // Generate smooth bezier curve with 8 points
    const bezierPoints = bezierCurve(fromEnd, toStart, fromDir, toDir, 8);
    
    // Convert to LngLat coordinates
    const path = proj.sumoShapeToLngLat(bezierPoints);

    connections.push({
      from: conn.from,
      to: conn.to,
      fromLane: conn.fromLane,
      toLane: conn.toLane,
      path,
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

// ─── F5 Compute Network Pipeline (SUMO netconvert equivalent) ───

/**
 * Remove self-loops: edges that connect a junction to itself.
 * Equivalent to NBNodeCont::removeSelfLoops()
 */
function removeSelfLoops(network: SUMONetwork): void {
  const edgesToRemove: string[] = [];
  network.edges.forEach((edge) => {
    if (edge.from === edge.to) {
      edgesToRemove.push(edge.id);
    }
  });
  for (const edgeId of edgesToRemove) {
    removeEdge(network, edgeId);
  }
}

/**
 * Join nearby junctions (placeholder - not fully implemented).
 * Equivalent to NBNodeCont::joinJunctions()
 */
function joinJunctions(network: SUMONetwork): void {
  // TODO: Implement junction joining logic if needed
  // For now, this is a no-op as junction joining is typically handled manually
}

/**
 * Sort nodes and edges for consistent ordering.
 * Equivalent to NBNodesEdgesSorter::sortNodesEdges()
 */
function sortNodesEdges(network: SUMONetwork): void {
  // Our Map-based data structure doesn't need explicit sorting,
  // but we ensure consistent iteration order
  // (Maps in JS maintain insertion order, which is sufficient)
}

/**
 * Compute lane-to-lane connections based on geometry.
 * Equivalent to NBNode::computeLanes2Lanes()
 * This automatically creates connections based on lane geometry and angles.
 */
function computeLanes2Lanes(network: SUMONetwork): void {
  // Clear existing connections (they will be recomputed)
  network.connections = [];

  // For each junction, compute connections between incoming and outgoing edges
  network.junctions.forEach((junction) => {
    if (junction.type === "internal") return;

    const incomingEdges: SUMOEdge[] = [];
    const outgoingEdges: SUMOEdge[] = [];

    network.edges.forEach((edge) => {
      if (edge.to === junction.id) incomingEdges.push(edge);
      if (edge.from === junction.id) outgoingEdges.push(edge);
    });

    // For each incoming edge, find best matching outgoing edges
    for (const inEdge of incomingEdges) {
      if (inEdge.lanes.length === 0) continue;

      // Compute incoming direction (at junction)
      const inDir = inEdge.shape.length >= 2
        ? normalize(sub(inEdge.shape[inEdge.shape.length - 1], inEdge.shape[inEdge.shape.length - 2]))
        : ([0, 1] as XY);

      // Find best outgoing edges based on angle
      const candidates: { edge: SUMOEdge; angle: number }[] = [];
      for (const outEdge of outgoingEdges) {
        if (outEdge.lanes.length === 0) continue;
        if (outEdge.id === inEdge.id) continue; // Don't connect to same edge

        // Compute outgoing direction (at junction)
        const outDir = outEdge.shape.length >= 2
          ? normalize(sub(outEdge.shape[1], outEdge.shape[0]))
          : ([0, 1] as XY);

        // Compute angle between directions (smaller is better)
        const angle = Math.abs(Math.atan2(cross(inDir, outDir), dot(inDir, outDir)));
        candidates.push({ edge: outEdge, angle });
      }

      // Sort by angle (prefer straight connections, then right turns, then left turns)
      candidates.sort((a, b) => a.angle - b.angle);

      // Create connections: connect each incoming lane to appropriate outgoing lanes
      // Only connect to the best matching outgoing edge(s) based on angle
      // For straight-through connections, connect all lanes
      // For turns, connect only the appropriate lanes
      for (let fromLaneIdx = 0; fromLaneIdx < inEdge.numLanes; fromLaneIdx++) {
        // Connect to the best matching outgoing edge (smallest angle)
        if (candidates.length > 0) {
          const bestCandidate = candidates[0];
          const outEdge = bestCandidate.edge;
          
          // Determine which outgoing lane to connect to
          // Rightmost lane connects to rightmost, leftmost to leftmost
          const toLaneIdx = Math.min(fromLaneIdx, outEdge.numLanes - 1);
          addConnection(network, inEdge.id, outEdge.id, fromLaneIdx, toLaneIdx);
        }
        
        // Also connect to other good candidates if angle is small (straight connections)
        // This handles cases where multiple outgoing edges are nearly straight
        for (let i = 1; i < candidates.length && i < 3; i++) {
          if (candidates[i].angle < Math.PI / 4) { // Less than 45 degrees
            const outEdge = candidates[i].edge;
            const toLaneIdx = Math.min(fromLaneIdx, outEdge.numLanes - 1);
            addConnection(network, inEdge.id, outEdge.id, fromLaneIdx, toLaneIdx);
          }
        }
      }
    }
  });
}

/**
 * Compute junction priority logic (first pass).
 * Equivalent to NBNode::computeLogic()
 * Determines right-of-way rules for priority junctions.
 */
function computeLogics(network: SUMONetwork): void {
  // For priority junctions, determine which edges have priority
  // This affects connection states (e.g., 'M' for major, 'm' for minor)
  network.junctions.forEach((junction) => {
    if (junction.type !== "priority") return;

    // Find all edges at this junction
    const edges: SUMOEdge[] = [];
    network.edges.forEach((edge) => {
      if (edge.from === junction.id || edge.to === junction.id) {
        edges.push(edge);
      }
    });

    // Simple priority: edges with higher priority attribute get right-of-way
    // For now, we mark all connections as 'M' (major/priority)
    // More sophisticated logic can be added later
    network.connections.forEach((conn) => {
      const fromEdge = network.edges.get(conn.from);
      if (fromEdge && fromEdge.to === junction.id) {
        // Connection state: 'M' = major (has priority), 'm' = minor (yield)
        // For now, set all to 'M' (can be refined based on edge priorities)
        conn.state = "M";
      }
    });
  });
}

/**
 * Compute junction priority logic (second pass).
 * Equivalent to NBNode::computeLogic2()
 * Refines priority rules based on geometry and conflicts.
 */
function computeLogics2(network: SUMONetwork): void {
  // Second pass: refine connection states based on conflicts
  // For now, this is a placeholder that can be extended
  // In SUMO, this handles complex priority rules and conflict detection
  network.junctions.forEach((junction) => {
    if (junction.type !== "priority") return;

    // Check for conflicting connections and adjust states
    // This is simplified - full implementation would detect actual conflicts
    const junctionConnections = network.connections.filter((conn) => {
      const fromEdge = network.edges.get(conn.from);
      return fromEdge && fromEdge.to === junction.id;
    });

    // Mark conflicting connections (crossing paths) as yielding
    // For now, we keep the state from computeLogics()
    // Full implementation would analyze geometry to find conflicts
  });
}

/**
 * Compute traffic light logics for all traffic light junctions.
 * Equivalent to NBTrafficLightLogicCont::computeLogics()
 */
function computeTrafficLightLogics(network: SUMONetwork): void {
  // Remove existing TLS programs (they will be regenerated)
  network.tlLogics = [];

  // Generate TLS programs for all traffic light junctions
  network.junctions.forEach((junction) => {
    if (junction.type === "traffic_light") {
      const tls = generateTLSProgram(junction.id, network);
      network.tlLogics.push(tls);

      // Update connections with TLS references
      let linkIdx = 0;
      network.connections.forEach((conn) => {
        const fromEdge = network.edges.get(conn.from);
        if (fromEdge && fromEdge.to === junction.id) {
          conn.tl = junction.id;
          conn.linkIndex = linkIdx++;
        }
      });
    } else {
      // Clear TLS references for non-TL junctions
      network.connections.forEach((conn) => {
        const fromEdge = network.edges.get(conn.from);
        if (fromEdge && fromEdge.to === junction.id) {
          conn.tl = "";
          conn.linkIndex = -1;
        }
      });
    }
  });
}

/**
 * Remake connections after network computation.
 * Equivalent to edge->remakeGNEConnections(true)
 * Updates connection geometry and validates connections.
 */
function remakeConnections(network: SUMONetwork): void {
  // Validate and update connections
  // Remove invalid connections (edges/lanes that no longer exist)
  network.connections = network.connections.filter((conn) => {
    const fromEdge = network.edges.get(conn.from);
    const toEdge = network.edges.get(conn.to);
    if (!fromEdge || !toEdge) return false;
    if (conn.fromLane < 0 || conn.fromLane >= fromEdge.numLanes) return false;
    if (conn.toLane < 0 || conn.toLane >= toEdge.numLanes) return false;
    return true;
  });
}

/**
 * Update junction geometry after network computation.
 * Equivalent to junction->updateGeometryAfterNetbuild()
 */
function updateJunctionGeometry(network: SUMONetwork): void {
  // Junction shapes are already computed in computeNodeShapes()
  // This step ensures geometry is consistent
  network.junctions.forEach((junction) => {
    if (junction.type === "internal") return;
    // Ensure shape is valid
    if (junction.shape.length < 3 && !junction.customShape) {
      // Fallback to default shape
      const s = 2;
      junction.shape = [
        [junction.x - s, junction.y - s],
        [junction.x + s, junction.y - s],
        [junction.x + s, junction.y + s],
        [junction.x - s, junction.y + s],
      ];
    }
  });
}

/**
 * Rebuild walking areas (placeholder - not fully implemented).
 * Equivalent to junction->rebuildGNEWalkingAreas()
 */
function rebuildWalkingAreas(network: SUMONetwork): void {
  // TODO: Implement walking area computation if needed
  // For now, this is a no-op
}

/**
 * Update edge geometry after network computation.
 * Equivalent to edge->updateGeometry()
 */
function updateEdgeGeometry(network: SUMONetwork): void {
  // Ensure all edges have valid geometry
  network.edges.forEach((edge) => {
    // Ensure edge endpoints are at junction centers
    const fromJ = network.junctions.get(edge.from);
    const toJ = network.junctions.get(edge.to);

    if (fromJ && edge.shape.length > 0) {
      const distFromJ = dist(edge.shape[0], [fromJ.x, fromJ.y]);
      if (distFromJ > 0.01) {
        edge.shape[0] = [fromJ.x, fromJ.y];
      }
    }

    if (toJ && edge.shape.length > 0) {
      const lastIdx = edge.shape.length - 1;
      const distToJ = dist(edge.shape[lastIdx], [toJ.x, toJ.y]);
      if (distToJ > 0.01) {
        edge.shape[lastIdx] = [toJ.x, toJ.y];
      }
    }

    // Recompute lane shapes
    recomputeLaneShapes(edge, network);
  });
}

/**
 * Recompute the full network geometry (equivalent to netconvert's computeNetwork).
 * 
 * This follows SUMO's F5 compute network pipeline exactly:
 * 1. Remove self loops
 * 2. Join junctions
 * 3. Sort nodes/edges
 * 4. Compute node shapes
 * 5. Compute lanes2lanes (connections)
 * 6. Compute logics (first pass)
 * 7. Compute logics2 (second pass)
 * 8. Compute traffic light logics
 * 9. Remake connections
 * 10. Update junction geometry
 * 11. Rebuild walking areas
 * 12. Update edge geometry
 * 
 * IMPORTANT: Edge shapes in the network data structure ALWAYS extend to junction centers.
 * Edge trimming only happens during rendering in buildRenderableNetwork().
 */
export function computeNetwork(network: SUMONetwork): void {
  // Step 1: Remove self loops
  removeSelfLoops(network);

  // Step 2: Join junctions (placeholder)
  joinJunctions(network);

  // Step 3: Sort nodes/edges
  sortNodesEdges(network);

  // Step 4: Ensure edge endpoints are at junction centers and recompute lane shapes
  updateEdgeGeometry(network);

  // Step 5: Compute node shapes (using untrimmed edges that extend to junction centers)
  // This matches SUMO's NBNodeCont::computeNodeShapes()
  network.junctions.forEach((junction) => {
    if (junction.type === "internal") return;
    junction.shape = computeNodeShape(junction, network.edges);
  });

  // Step 6: Compute lanes2lanes (automatic connection generation)
  computeLanes2Lanes(network);

  // Step 7: Compute logics (first pass - priority rules)
  computeLogics(network);

  // Step 8: Compute logics2 (second pass - conflict resolution)
  computeLogics2(network);

  // Step 9: Compute traffic light logics
  computeTrafficLightLogics(network);

  // Step 10: Remake connections (validate and update)
  remakeConnections(network);

  // Step 11: Update junction geometry
  updateJunctionGeometry(network);

  // Step 12: Rebuild walking areas (placeholder)
  rebuildWalkingAreas(network);

  // Step 13: Final edge geometry update
  updateEdgeGeometry(network);
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

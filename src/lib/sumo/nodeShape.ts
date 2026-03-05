/**
 * Port of NBNodeShapeComputer from SUMO's netconvert.
 *
 * For each pair of adjacent edges (sorted by angle), intersect their outer
 * lane boundaries to get the junction polygon vertices. Edges are also trimmed
 * (setback) so they stop at the junction boundary instead of its center.
 */
import type { SUMOJunction, SUMOEdge, XY, SpreadType } from "./types";
import {
  add,
  sub,
  scale,
  normalize,
  perpRight,
  SUMO_DEFAULT_LANE_WIDTH,
  angle as vecAngle,
  lineIntersection,
  dist,
  convexHull,
} from "./geometry";

const DEFAULT_RADIUS = 1.5;
const MIN_SETBACK = 2.5;

interface EdgeEnd {
  edge: SUMOEdge;
  isIncoming: boolean;
  /** Direction pointing AWAY from the junction */
  dir: XY;
  /** Angle of dir for sorting */
  ang: number;
  halfWidth: number;
  /** The outer-right boundary point at the node */
  ccwBoundary: XY;
  /** The outer-left boundary point at the node */
  cwBoundary: XY;
}

function computeGapCorner(curr: EdgeEnd, next: EdgeEnd, nodePos: XY): XY | null {
  const p1 = curr.cwBoundary;
  const d1 = curr.dir;
  const p2 = next.ccwBoundary;
  const d2 = next.dir;

  const t = lineIntersection(p1, d1, p2, d2);
  const u = lineIntersection(p2, d2, p1, d1);
  if (t === null || u === null || isNaN(t) || isNaN(u)) return null;

  // The corner must lie "inside" the junction, i.e. behind both boundaries
  // when following edge directions away from the node.
  if (t > 1e-6 || u > 1e-6) return null;

  const ix = add(p1, scale(d1, t));
  const maxDist = Math.max(curr.halfWidth, next.halfWidth) * 3 + 5;
  return dist(ix, nodePos) < maxDist ? ix : null;
}

function twoEdgeShape(a: EdgeEnd, b: EdgeEnd, nodePos: XY): XY[] {
  const setbackA = Math.max(MIN_SETBACK, a.halfWidth + 0.5);
  const setbackB = Math.max(MIN_SETBACK, b.halfWidth + 0.5);

  const points: XY[] = [
    add(a.ccwBoundary, scale(a.dir, -setbackA)),
    add(a.cwBoundary, scale(a.dir, -setbackA)),
    add(b.ccwBoundary, scale(b.dir, -setbackB)),
    add(b.cwBoundary, scale(b.dir, -setbackB)),
  ];

  const cornerAB = computeGapCorner(a, b, nodePos);
  if (cornerAB) points.push(cornerAB);
  const cornerBA = computeGapCorner(b, a, nodePos);
  if (cornerBA) points.push(cornerBA);

  const dedup: XY[] = [];
  const eps = 1e-3;
  for (const p of points) {
    const exists = dedup.some((q) => dist(p, q) < eps);
    if (!exists) dedup.push(p);
  }

  if (dedup.length < 3) return fallbackShape(nodePos, [a, b]);
  return sanitizePolygon(dedup, nodePos, [a, b]);
}

/**
 * Compute the junction polygon and return it along with the setback distances
 * for each edge, so edge geometry can be trimmed.
 */
export function computeNodeShape(
  junction: SUMOJunction,
  edges: Map<string, SUMOEdge>
): XY[] {
  if (junction.customShape && junction.shape.length > 0) {
    return junction.shape;
  }

  const nodePos: XY = [junction.x, junction.y];
  const edgeEnds: EdgeEnd[] = [];

  edges.forEach((edge) => {
    if (edge.from === junction.id) {
      const dir =
        edge.shape.length >= 2
          ? normalize(sub(edge.shape[1], edge.shape[0]))
          : ([1, 0] as XY);
      pushEdgeEnd(edgeEnds, edge, false, dir, nodePos);
    }
    if (edge.to === junction.id) {
      const dir =
        edge.shape.length >= 2
          ? normalize(sub(edge.shape[edge.shape.length - 2], edge.shape[edge.shape.length - 1]))
          : ([-1, 0] as XY);
      pushEdgeEnd(edgeEnds, edge, true, dir, nodePos);
    }
  });

  if (edgeEnds.length === 0) {
    const s = DEFAULT_RADIUS;
    return [
      [nodePos[0] - s, nodePos[1] - s],
      [nodePos[0] + s, nodePos[1] - s],
      [nodePos[0] + s, nodePos[1] + s],
      [nodePos[0] - s, nodePos[1] + s],
    ];
  }

  if (edgeEnds.length === 1) {
    return deadEndShape(edgeEnds[0], nodePos);
  }

  // Sort CCW by angle (SUMO's Y-up coord system)
  edgeEnds.sort((a, b) => a.ang - b.ang);

  if (edgeEnds.length === 2) {
    return twoEdgeShape(edgeEnds[0], edgeEnds[1], nodePos);
  }

  const n = edgeEnds.length;
  const shapePoints: XY[] = [];

  for (let i = 0; i < n; i++) {
    const curr = edgeEnds[i];
    const next = edgeEnds[(i + 1) % n];

    // Between curr and next there is a gap.
    // curr's CW (left-looking-away) boundary faces next's CCW (right-looking-away) boundary.
    //
    // In SUMO coords (Y-up), looking away from node along the edge:
    //   right = perpRight(dir)  → CW side of that edge as seen from the gap
    //   left  = -perpRight(dir) → CCW side
    //
    // The boundary we want on curr's side of the gap is curr's CW boundary.
    // The boundary we want on next's side of the gap is next's CCW boundary.

    const corner = computeGapCorner(curr, next, nodePos);
    if (corner) {
      shapePoints.push(corner);
      continue;
    }

    // Fallback for parallel/collinear edges or very far intersections:
    // two separate points pulled inward
    const setback = Math.max(MIN_SETBACK, Math.max(curr.halfWidth, next.halfWidth) + 0.5);
    shapePoints.push(add(curr.cwBoundary, scale(curr.dir, -setback)));
    shapePoints.push(add(next.ccwBoundary, scale(next.dir, -setback)));
  }

  return shapePoints.length >= 3 ? sanitizePolygon(shapePoints, nodePos, edgeEnds) : fallbackShape(nodePos, edgeEnds);
}

function isSelfIntersecting(poly: XY[]): boolean {
  const n = poly.length;
  if (n < 4) return false;

  for (let i = 0; i < n; i++) {
    const a1 = poly[i];
    const a2 = poly[(i + 1) % n];

    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges and first-last adjacency
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === n - 1) continue;

      const b1 = poly[j];
      const b2 = poly[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  const eps = 1e-9;

  if (Math.abs(o1) < eps && onSegment(a, b, c)) return true;
  if (Math.abs(o2) < eps && onSegment(a, b, d)) return true;
  if (Math.abs(o3) < eps && onSegment(c, d, a)) return true;
  if (Math.abs(o4) < eps && onSegment(c, d, b)) return true;

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function orient(a: XY, b: XY, c: XY): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: XY, b: XY, p: XY): boolean {
  return (
    p[0] >= Math.min(a[0], b[0]) - 1e-9 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-9 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-9 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-9
  );
}

function sanitizePolygon(points: XY[], nodePos: XY, edgeEnds: EdgeEnd[]): XY[] {
  const dedup: XY[] = [];
  const eps = 1e-3;
  for (const p of points) {
    const exists = dedup.some((q) => dist(p, q) < eps);
    if (!exists) dedup.push(p);
  }

  if (dedup.length < 3) return fallbackShape(nodePos, edgeEnds);

  const ordered = [...dedup].sort(
    (p, q) => vecAngle(sub(p, nodePos)) - vecAngle(sub(q, nodePos))
  );

  if (!isSelfIntersecting(ordered)) return ordered;

  const hull = convexHull(ordered);
  return hull.length >= 3 ? hull : fallbackShape(nodePos, edgeEnds);
}

function pushEdgeEnd(
  out: EdgeEnd[],
  edge: SUMOEdge,
  isIncoming: boolean,
  dir: XY,
  nodePos: XY
): void {
  const laneWidth = edge.width || SUMO_DEFAULT_LANE_WIDTH;
  const totalWidth = edge.numLanes * laneWidth;

  // perpRight gives the rightward normal when looking along dir (Y-up system)
  const right = perpRight(dir);

  // Compute boundary offsets based on spread type.
  // "right looking away" = CCW boundary, "left looking away" = CW boundary
  let rightOffset: number; // distance to the right of centerline
  let leftOffset: number;  // distance to the left of centerline (positive = left)

  if (edge.spreadType === "right") {
    // With spreadType "right", lanes are offset to the LEFT of centerline
    // (computeLaneShape uses negative offsets: -(laneIndex+0.5)*laneWidth)
    // For incoming edges, local direction at the node is reversed, so the
    // occupied side flips and boundary offsets must be swapped.
    if (isIncoming) {
      rightOffset = totalWidth;
      leftOffset = 0;
    } else {
      rightOffset = 0;
      leftOffset = totalWidth;
    }
  } else {
    // "center" and "roadCenter": lanes spread symmetrically
    rightOffset = totalWidth / 2;
    leftOffset = totalWidth / 2;
  }

  const ccwBoundary = add(nodePos, scale(right, rightOffset));
  const cwBoundary  = add(nodePos, scale(right, -leftOffset));
  const halfWidth = totalWidth / 2;

  out.push({
    edge,
    isIncoming,
    dir,
    ang: vecAngle(dir),
    halfWidth,
    ccwBoundary,
    cwBoundary,
  });
}

function deadEndShape(e: EdgeEnd, nodePos: XY): XY[] {
  const hw = e.halfWidth + 0.5;
  const right = perpRight(e.dir);
  const setback = Math.max(MIN_SETBACK, e.halfWidth);
  const back = scale(e.dir, -setback);
  // Rectangle: two points at road width, two pulled back
  return [
    add(nodePos, scale(right, hw)),
    add(add(nodePos, scale(right, hw)), back),
    add(add(nodePos, scale(right, -hw)), back),
    add(nodePos, scale(right, -hw)),
  ];
}

function fallbackShape(nodePos: XY, edgeEnds: EdgeEnd[]): XY[] {
  let r = DEFAULT_RADIUS;
  for (const e of edgeEnds) r = Math.max(r, e.halfWidth + 1);
  return [
    [nodePos[0] - r, nodePos[1] - r],
    [nodePos[0] + r, nodePos[1] - r],
    [nodePos[0] + r, nodePos[1] + r],
    [nodePos[0] - r, nodePos[1] + r],
  ];
}

// ─── Edge trimming ───

/**
 * Trim an edge's shape so it starts/ends at the junction boundary
 * instead of the junction center. Called after junction shapes are computed.
 */
export function trimEdgeAtJunctions(
  edge: SUMOEdge,
  junctions: Map<string, SUMOJunction>,
  edges: Map<string, SUMOEdge>
): void {
  if (edge.shape.length < 2) return;

  const fromJ = junctions.get(edge.from);
  const toJ = junctions.get(edge.to);

  // Compute setback distances from each junction
  const fromSetback = fromJ ? computeSetback(fromJ, edge, edges) : 0;
  const toSetback = toJ ? computeSetback(toJ, edge, edges) : 0;

  // Trim the start of the shape
  if (fromSetback > 0) {
    edge.shape = trimPolylineStart(edge.shape, fromSetback);
  }

  // Trim the end of the shape
  if (toSetback > 0) {
    edge.shape = trimPolylineEnd(edge.shape, toSetback);
  }
}

export function computeSetback(
  junction: SUMOJunction,
  _edge: SUMOEdge,
  allEdges: Map<string, SUMOEdge>
): number {
  let maxHalfWidth = 0;
  let edgeCount = 0;
  allEdges.forEach((e) => {
    if (e.from === junction.id || e.to === junction.id) {
      const hw = (e.numLanes * (e.width || SUMO_DEFAULT_LANE_WIDTH)) / 2;
      maxHalfWidth = Math.max(maxHalfWidth, hw);
      edgeCount++;
    }
  });

  if (edgeCount <= 1) return MIN_SETBACK;

  // Setback = roughly the half-width of the widest road + a bit
  return Math.max(MIN_SETBACK, maxHalfWidth + 1);
}

export function trimPolylineStart(shape: XY[], amount: number): XY[] {
  if (shape.length < 2 || amount <= 0) return shape;

  let remaining = amount;

  for (let i = 0; i < shape.length - 1; i++) {
    const segLen = dist(shape[i], shape[i + 1]);
    if (remaining < segLen) {
      const ratio = remaining / segLen;
      const newStart: XY = [
        shape[i][0] + ratio * (shape[i + 1][0] - shape[i][0]),
        shape[i][1] + ratio * (shape[i + 1][1] - shape[i][1]),
      ];
      return [newStart, ...shape.slice(i + 1)];
    }
    remaining -= segLen;
  }

  // If amount exceeds total length, just keep last two points close together
  return shape.slice(-2);
}

export function trimPolylineEnd(shape: XY[], amount: number): XY[] {
  if (shape.length < 2 || amount <= 0) return shape;

  let remaining = amount;

  for (let i = shape.length - 1; i > 0; i--) {
    const segLen = dist(shape[i], shape[i - 1]);
    if (remaining < segLen) {
      const ratio = remaining / segLen;
      const newEnd: XY = [
        shape[i][0] + ratio * (shape[i - 1][0] - shape[i][0]),
        shape[i][1] + ratio * (shape[i - 1][1] - shape[i][1]),
      ];
      return [...shape.slice(0, i), newEnd];
    }
    remaining -= segLen;
  }

  return shape.slice(0, 2);
}

/**
 * Recompute all junction shapes in the network.
 */
export function recomputeAllNodeShapes(
  junctions: Map<string, SUMOJunction>,
  edges: Map<string, SUMOEdge>
): void {
  junctions.forEach((junction) => {
    if (junction.type === "internal") return;
    junction.shape = computeNodeShape(junction, edges);
  });
}

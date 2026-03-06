/**
 * Port of NBNodeShapeComputer from SUMO's netconvert.
 *
 * For each pair of adjacent edges (sorted by angle), intersect their outer
 * lane boundaries to get the junction polygon vertices. Edges are also trimmed
 * (setback) so they stop at the junction boundary instead of its center.
 */
import type { SUMOJunction, SUMOEdge, XY } from "./types";
import {
  add,
  sub,
  scale,
  normalize,
  offsetPolyline,
  SUMO_DEFAULT_LANE_WIDTH,
  angle as vecAngle,
  dist,
  convexHull,
} from "./geometry";

const DEFAULT_RADIUS = 1.5;
const MIN_SETBACK = 2.5;
const EXT = 100;
const EXT2 = 10;

interface EdgeEnd {
  edge: SUMOEdge;
  dir: XY;
  ang: number;
  totalWidth: number;
  halfWidth: number;
  /** Counter-clockwise (left) edge boundary, oriented away from node */
  ccwBoundary: XY[];
  /** Clockwise (right) edge boundary, oriented away from node */
  cwBoundary: XY[];
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
    if (edge.from !== junction.id && edge.to !== junction.id) return;
    const end = buildEdgeEnd(edge, junction, nodePos);
    if (end) {
      edgeEnds.push(end);
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

  // Sort by direction around the node and compute neighbor-based cut offsets.
  edgeEnds.sort((a, b) => a.ang - b.ang);
  const n = edgeEnds.length;
  const offsets: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const curr = edgeEnds[i];
    const prev = edgeEnds[(i - 1 + n) % n];
    const next = edgeEnds[(i + 1) % n];
    const defaultOffset = EXT + Math.max(MIN_SETBACK, curr.halfWidth);

    const ccwOffset = closestIntersectionOffset(curr.ccwBoundary, prev.cwBoundary, EXT);
    const cwOffset = closestIntersectionOffset(curr.cwBoundary, next.ccwBoundary, EXT);

    let finalCCW = ccwOffset === null ? defaultOffset : ccwOffset + MIN_SETBACK;
    let finalCW = cwOffset === null ? defaultOffset : cwOffset + MIN_SETBACK;

    // Preserve roughly rectangular cuts unless the two sides diverge strongly.
    if (Math.abs(finalCCW - finalCW) < 5) {
      const merged = Math.max(finalCCW, finalCW);
      finalCCW = merged;
      finalCW = merged;
    }
    offsets.push([finalCCW, finalCW]);
  }

  const ret: XY[] = [];
  for (let i = 0; i < n; i++) {
    const curr = edgeEnds[i];
    const [offCCW, offCW] = offsets[i];
    ret.push(pointAtOffset(curr.ccwBoundary, offCCW));
    ret.push(pointAtOffset(curr.cwBoundary, offCW));
  }
  return finalizeOrderedPolygon(ret, nodePos, edgeEnds);
}

function buildEdgeEnd(edge: SUMOEdge, junction: SUMOJunction, nodePos: XY): EdgeEnd | null {
  const oriented = orientEdgeShapeAwayFromNode(edge, junction.id, nodePos);
  if (oriented.length < 2) return null;
  const dir = directionAtStart(oriented);
  if (Math.abs(dir[0]) < 1e-8 && Math.abs(dir[1]) < 1e-8) return null;

  const defaultLaneWidth = edge.width || SUMO_DEFAULT_LANE_WIDTH;
  const [minRightCoord, maxRightCoord] = computeLateralBounds(edge, defaultLaneWidth);
  const totalWidth = Math.max(1e-3, maxRightCoord - minRightCoord);
  const ccwBoundary = buildBoundary(oriented, minRightCoord, totalWidth);
  const cwBoundary = buildBoundary(oriented, maxRightCoord, totalWidth);

  return {
    edge,
    dir,
    ang: vecAngle(dir),
    totalWidth,
    halfWidth: Math.max(0.5, totalWidth / 2),
    ccwBoundary,
    cwBoundary,
  };
}

function orientEdgeShapeAwayFromNode(edge: SUMOEdge, nodeId: string, nodePos: XY): XY[] {
  if (edge.shape.length === 0) return [];
  let oriented: XY[];
  if (edge.from === nodeId) {
    oriented = edge.shape.map((p) => [p[0], p[1]] as XY);
  } else if (edge.to === nodeId) {
    oriented = [...edge.shape].reverse().map((p) => [p[0], p[1]] as XY);
  } else {
    return [];
  }

  if (dist(oriented[0], nodePos) > 1e-3) {
    oriented.unshift([nodePos[0], nodePos[1]]);
  }
  return oriented;
}

function directionAtStart(shape: XY[]): XY {
  for (let i = 1; i < shape.length; i++) {
    const dir = normalize(sub(shape[i], shape[0]));
    if (Math.abs(dir[0]) > 1e-8 || Math.abs(dir[1]) > 1e-8) return dir;
  }
  return [0, 0];
}

function buildBoundary(orientedCenter: XY[], sideOffset: number, totalWidth: number): XY[] {
  let boundary = offsetPolyline(orientedCenter, sideOffset);
  if (boundary.length < 2) {
    boundary = orientedCenter;
  }
  boundary = truncatePolyline(boundary, Math.max(EXT, totalWidth));
  boundary = extrapolateStart(boundary, EXT);
  boundary = extrapolateEnd(boundary, EXT2);
  return boundary;
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
  const dedup = dedupePoints(points, 1e-3);

  if (dedup.length < 3) return fallbackShape(nodePos, edgeEnds);

  const ordered = [...dedup].sort(
    (p, q) => vecAngle(sub(p, nodePos)) - vecAngle(sub(q, nodePos))
  );

  if (!isSelfIntersecting(ordered)) return ordered;

  const hull = convexHull(ordered);
  return hull.length >= 3 ? hull : fallbackShape(nodePos, edgeEnds);
}

function dedupePoints(points: XY[], eps: number): XY[] {
  const dedup: XY[] = [];
  for (const p of points) {
    const exists = dedup.some((q) => dist(p, q) < eps);
    if (!exists) dedup.push(p);
  }
  return dedup;
}

function computeLateralBounds(edge: SUMOEdge, defaultLaneWidth: number): [number, number] {
  const laneCount = Math.max(1, edge.numLanes || edge.lanes.length || 1);
  const sorted = edge.lanes.length
    ? [...edge.lanes].sort((a, b) => a.index - b.index)
    : Array.from({ length: laneCount }, (_, i) => ({
        index: i,
        width: defaultLaneWidth,
      }));

  const widths = sorted.map((lane) => (lane.width && lane.width > 0 ? lane.width : defaultLaneWidth));
  const total = widths.reduce((sum, w) => sum + w, 0);
  const spreadType = edge.spreadType || "right";

  if (spreadType === "right") {
    // SUMO "right": lane block starts at centerline and extends to positive right side.
    let cursor = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const w of widths) {
      const start = cursor;
      const end = cursor + w;
      min = Math.min(min, start);
      max = Math.max(max, end);
      cursor = end;
    }
    return [min, max];
  }

  // center / roadCenter: symmetric around edge centerline.
  let cursor = -total / 2;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const w of widths) {
    const start = cursor;
    const end = cursor + w;
    min = Math.min(min, start);
    max = Math.max(max, end);
    cursor = end;
  }
  return [min, max];
}

function deadEndShape(e: EdgeEnd, nodePos: XY): XY[] {
  const setback = EXT + Math.max(MIN_SETBACK, e.halfWidth);
  const leftNear = pointAtOffset(e.ccwBoundary, EXT);
  const leftFar = pointAtOffset(e.ccwBoundary, setback);
  const rightFar = pointAtOffset(e.cwBoundary, setback);
  const rightNear = pointAtOffset(e.cwBoundary, EXT);
  return [
    leftNear,
    leftFar,
    rightFar,
    rightNear,
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

function finalizeOrderedPolygon(points: XY[], nodePos: XY, edgeEnds: EdgeEnd[]): XY[] {
  const dedup = dedupePoints(points, 1e-3);
  if (dedup.length < 3) return fallbackShape(nodePos, edgeEnds);
  if (isSelfIntersecting(dedup)) {
    const hull = convexHull(dedup);
    return hull.length >= 3 ? hull : fallbackShape(nodePos, edgeEnds);
  }
  return dedup;
}

function closestIntersectionOffset(a: XY[], b: XY[], target: number): number | null {
  const offsets = polylineIntersectionsOffsets(a, b);
  if (offsets.length === 0) return null;
  let best = offsets[0];
  let bestDelta = Math.abs(best - target);
  for (let i = 1; i < offsets.length; i++) {
    const d = Math.abs(offsets[i] - target);
    if (d < bestDelta) {
      bestDelta = d;
      best = offsets[i];
    }
  }
  return best;
}

function polylineIntersectionsOffsets(a: XY[], b: XY[]): number[] {
  if (a.length < 2 || b.length < 2) return [];
  const offsets: number[] = [];
  let traveledA = 0;
  const eps = 1e-8;

  for (let i = 0; i < a.length - 1; i++) {
    const a1 = a[i];
    const a2 = a[i + 1];
    const lenA = dist(a1, a2);
    if (lenA < eps) continue;

    for (let j = 0; j < b.length - 1; j++) {
      const b1 = b[j];
      const b2 = b[j + 1];
      const t = segmentIntersectionParam(a1, a2, b1, b2);
      if (t === null || t < -eps || t > 1 + eps) continue;
      const clamped = Math.max(0, Math.min(1, t));
      offsets.push(traveledA + clamped * lenA);
    }
    traveledA += lenA;
  }
  return offsets;
}

function pointAtOffset(shape: XY[], offset: number): XY {
  if (shape.length === 0) return [0, 0];
  if (shape.length === 1) return shape[0];
  if (offset <= 0) return shape[0];

  let traveled = 0;
  for (let i = 0; i < shape.length - 1; i++) {
    const a = shape[i];
    const b = shape[i + 1];
    const seg = dist(a, b);
    if (seg < 1e-10) continue;
    if (traveled + seg >= offset) {
      const t = (offset - traveled) / seg;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    traveled += seg;
  }
  return shape[shape.length - 1];
}

function truncatePolyline(shape: XY[], maxLen: number): XY[] {
  if (shape.length < 2 || maxLen <= 0) return shape.slice(0, 1);
  let traveled = 0;
  const out: XY[] = [shape[0]];

  for (let i = 0; i < shape.length - 1; i++) {
    const a = shape[i];
    const b = shape[i + 1];
    const seg = dist(a, b);
    if (seg < 1e-10) continue;
    if (traveled + seg <= maxLen) {
      out.push(b);
      traveled += seg;
      continue;
    }
    const t = (maxLen - traveled) / seg;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    break;
  }
  return out;
}

function extrapolateStart(shape: XY[], amount: number): XY[] {
  if (shape.length < 2 || amount <= 0) return shape;
  const dir = normalize(sub(shape[1], shape[0]));
  if (Math.abs(dir[0]) < 1e-10 && Math.abs(dir[1]) < 1e-10) return shape;
  const start = add(shape[0], scale(dir, -amount));
  return [start, ...shape];
}

function extrapolateEnd(shape: XY[], amount: number): XY[] {
  if (shape.length < 2 || amount <= 0) return shape;
  const n = shape.length;
  const dir = normalize(sub(shape[n - 1], shape[n - 2]));
  if (Math.abs(dir[0]) < 1e-10 && Math.abs(dir[1]) < 1e-10) return shape;
  const end = add(shape[n - 1], scale(dir, amount));
  return [...shape, end];
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
  edge: SUMOEdge,
  allEdges: Map<string, SUMOEdge>
): number {
  const geometricSetback = computeSetbackFromJunctionShape(junction, edge);
  if (geometricSetback !== null) {
    return geometricSetback;
  }

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

function computeSetbackFromJunctionShape(junction: SUMOJunction, edge: SUMOEdge): number | null {
  if (junction.shape.length < 3 || edge.shape.length < 2) return null;
  if (edge.from !== junction.id && edge.to !== junction.id) return null;

  const oriented = edge.from === junction.id ? edge.shape : [...edge.shape].reverse();
  const polygon = junction.shape;
  const epsilon = 1e-6;
  let traveled = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < oriented.length - 1; i++) {
    const segmentStart = oriented[i];
    const segmentEnd = oriented[i + 1];
    const segmentLength = dist(segmentStart, segmentEnd);
    if (segmentLength < epsilon) continue;

    for (let j = 0; j < polygon.length; j++) {
      const boundaryStart = polygon[j];
      const boundaryEnd = polygon[(j + 1) % polygon.length];
      const t = segmentIntersectionParam(segmentStart, segmentEnd, boundaryStart, boundaryEnd);
      if (t === null || t < -epsilon || t > 1 + epsilon) continue;

      const clampedT = Math.max(0, Math.min(1, t));
      const intersectionDistance = traveled + clampedT * segmentLength;
      if (intersectionDistance > epsilon) {
        bestDistance = Math.min(bestDistance, intersectionDistance);
      }
    }
    traveled += segmentLength;
  }

  return Number.isFinite(bestDistance) ? Math.max(0, bestDistance) : null;
}

function segmentIntersectionParam(a: XY, b: XY, c: XY, d: XY): number | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const denom = r[0] * s[1] - r[1] * s[0];
  const qMinusP = sub(c, a);
  const epsilon = 1e-10;

  if (Math.abs(denom) < epsilon) return null;

  const t = (qMinusP[0] * s[1] - qMinusP[1] * s[0]) / denom;
  const u = (qMinusP[0] * r[1] - qMinusP[1] * r[0]) / denom;
  if (u < -1e-8 || u > 1 + 1e-8) return null;
  return t;
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

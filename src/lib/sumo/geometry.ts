/** Pure geometry utilities for SUMO network computations */
import type { XY } from "./types";

export const SUMO_DEFAULT_LANE_WIDTH = 3.2;

export function dist(a: XY, b: XY): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export function add(a: XY, b: XY): XY {
  return [a[0] + b[0], a[1] + b[1]];
}

export function sub(a: XY, b: XY): XY {
  return [a[0] - b[0], a[1] - b[1]];
}

export function scale(v: XY, s: number): XY {
  return [v[0] * s, v[1] * s];
}

export function normalize(v: XY): XY {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  if (len < 1e-10) return [0, 0];
  return [v[0] / len, v[1] / len];
}

export function length(v: XY): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1]);
}

export function dot(a: XY, b: XY): number {
  return a[0] * b[0] + a[1] * b[1];
}

export function cross(a: XY, b: XY): number {
  return a[0] * b[1] - a[1] * b[0];
}

/** Rotate vector 90 degrees counter-clockwise */
export function perpLeft(v: XY): XY {
  return [-v[1], v[0]];
}

/** Rotate vector 90 degrees clockwise */
export function perpRight(v: XY): XY {
  return [v[1], -v[0]];
}

export function angle(v: XY): number {
  return Math.atan2(v[1], v[0]);
}

export function angleBetween(a: XY, b: XY): number {
  return Math.atan2(cross(a, b), dot(a, b));
}

/** Offset a polyline to the right by distance d */
export function offsetPolyline(shape: XY[], d: number): XY[] {
  if (shape.length < 2) return shape;

  const result: XY[] = [];

  for (let i = 0; i < shape.length; i++) {
    let normal: XY;

    if (i === 0) {
      const dir = normalize(sub(shape[1], shape[0]));
      normal = perpRight(dir);
    } else if (i === shape.length - 1) {
      const dir = normalize(sub(shape[i], shape[i - 1]));
      normal = perpRight(dir);
    } else {
      const dir1 = normalize(sub(shape[i], shape[i - 1]));
      const dir2 = normalize(sub(shape[i + 1], shape[i]));
      const n1 = perpRight(dir1);
      const n2 = perpRight(dir2);
      normal = normalize(add(n1, n2));
      // Adjust offset for acute angles
      const cosHalf = dot(normal, n1);
      if (Math.abs(cosHalf) > 0.1) {
        normal = scale(normal, 1 / cosHalf);
      }
    }

    result.push(add(shape[i], scale(normal, d)));
  }

  return result;
}

/** Compute the length of a polyline */
export function polylineLength(shape: XY[]): number {
  let total = 0;
  for (let i = 1; i < shape.length; i++) {
    total += dist(shape[i - 1], shape[i]);
  }
  return total;
}

/** Get the direction vector at the start of a polyline */
export function startDirection(shape: XY[]): XY {
  if (shape.length < 2) return [1, 0];
  return normalize(sub(shape[1], shape[0]));
}

/** Get the direction vector at the end of a polyline */
export function endDirection(shape: XY[]): XY {
  if (shape.length < 2) return [1, 0];
  return normalize(sub(shape[shape.length - 1], shape[shape.length - 2]));
}

/** Intersect two infinite lines defined by point+direction. Returns parameter t for line 1. */
export function lineIntersection(
  p1: XY, d1: XY, p2: XY, d2: XY
): number | null {
  const denom = cross(d1, d2);
  if (Math.abs(denom) < 1e-10) return null;
  const dp = sub(p2, p1);
  return cross(dp, d2) / denom;
}

/** Create a simple polygon from boundary points */
export function convexHull(points: XY[]): XY[] {
  if (points.length <= 3) return points;

  // Sort by x, then y
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const lower: XY[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(p, lower[lower.length - 2])) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: XY[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(p, upper[upper.length - 2])) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Remove last point of each half because it's the first point of the other
  lower.pop();
  upper.pop();

  return lower.concat(upper);
}

/** Interpolate along a polyline at distance t from start */
export function interpolatePolyline(shape: XY[], targetDist: number): XY {
  if (shape.length === 0) return [0, 0];
  if (shape.length === 1) return shape[0];

  let remaining = targetDist;
  for (let i = 1; i < shape.length; i++) {
    const segLen = dist(shape[i - 1], shape[i]);
    if (remaining <= segLen || i === shape.length - 1) {
      const ratio = segLen > 0 ? Math.min(remaining / segLen, 1) : 0;
      return [
        shape[i - 1][0] + ratio * (shape[i][0] - shape[i - 1][0]),
        shape[i - 1][1] + ratio * (shape[i][1] - shape[i - 1][1]),
      ];
    }
    remaining -= segLen;
  }

  return shape[shape.length - 1];
}

/**
 * Generate a smooth bezier curve between two points with 8 control points.
 * Uses a cubic bezier curve with control points based on the directions at start and end.
 * 
 * @param p0 Start point
 * @param p1 End point
 * @param dir0 Direction at start (normalized vector)
 * @param dir1 Direction at end (normalized vector)
 * @param numPoints Number of points to generate (default: 8)
 * @returns Array of points along the bezier curve
 */
export function bezierCurve(
  p0: XY,
  p1: XY,
  dir0: XY,
  dir1: XY,
  numPoints: number = 8
): XY[] {
  // Calculate distance between points
  const d = dist(p0, p1);
  
  // Control point distance is proportional to the connection length
  // Use 1/3 of the distance for smooth curves
  const controlDist = d * 0.33;
  
  // First control point: extend from p0 in dir0 direction
  const cp1: XY = add(p0, scale(dir0, controlDist));
  
  // Second control point: extend backwards from p1 in opposite of dir1 direction
  const cp2: XY = add(p1, scale(dir1, -controlDist));
  
  // Generate points along the cubic bezier curve
  // Cubic bezier: B(t) = (1-t)³P₀ + 3(1-t)²tP₁ + 3(1-t)t²P₂ + t³P₃
  // where P₀=p0, P₁=cp1, P₂=cp2, P₃=p1
  const points: XY[] = [];
  
  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1); // t from 0 to 1
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    
    // Cubic bezier formula
    const x = mt3 * p0[0] + 3 * mt2 * t * cp1[0] + 3 * mt * t2 * cp2[0] + t3 * p1[0];
    const y = mt3 * p0[1] + 3 * mt2 * t * cp1[1] + 3 * mt * t2 * cp2[1] + t3 * p1[1];
    
    points.push([x, y]);
  }
  
  return points;
}

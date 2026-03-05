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

import proj4 from "proj4";
import type { XY, LngLat, SUMOLocation } from "./types";

/**
 * Converts between SUMO network coordinates and WGS84 lon/lat.
 *
 * SUMO convention (from GeoConvHelper):
 *   net_coord = proj_coord + offset    (geo2cartesian: transform then add offset)
 *   proj_coord = net_coord - offset    (cartesian2geo: subtract offset then transform)
 *
 * netOffset in net.xml is typically large negative, e.g. "-391440.03,-5820079.67"
 * so net coords end up small/positive.
 */
export function createProjection(location: SUMOLocation) {
  const { netOffset, projParameter } = location;

  const projDef = projParameter || "+proj=utm +zone=32 +ellps=WGS84 +datum=WGS84 +units=m +no_defs";

  const converter = proj4(projDef, "WGS84");

  function sumoToLngLat(xy: XY): LngLat {
    // proj = net - offset, then proj→WGS84
    const projX = xy[0] - netOffset[0];
    const projY = xy[1] - netOffset[1];
    const [lng, lat] = converter.forward([projX, projY]);
    return [lng, lat];
  }

  function lngLatToSumo(lnglat: LngLat): XY {
    // WGS84→proj, then net = proj + offset
    const [projX, projY] = converter.inverse(lnglat);
    return [projX + netOffset[0], projY + netOffset[1]];
  }

  function sumoShapeToLngLat(shape: XY[]): LngLat[] {
    return shape.map(sumoToLngLat);
  }

  function lngLatShapeToSumo(shape: LngLat[]): XY[] {
    return shape.map(lngLatToSumo);
  }

  return { sumoToLngLat, lngLatToSumo, sumoShapeToLngLat, lngLatShapeToSumo };
}

export type Projection = ReturnType<typeof createProjection>;

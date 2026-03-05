import type {
  SUMONetwork,
  SUMOLocation,
  SUMOJunction,
  SUMOEdge,
  SUMOLane,
  SUMOConnection,
  SUMOTLLogic,
  TLSPhase,
  XY,
  JunctionType,
  SpreadType,
  TLSType,
} from "./types";
import { SUMO_DEFAULT_LANE_WIDTH, offsetPolyline } from "./geometry";

const DEFAULT_SPREAD_TYPE: SpreadType = "right";

/**
 * Parse and normalize coordinates from XML.
 * Coordinates in SUMO's net.xml are in "net" coordinate system:
 *   net_coord = proj_coord + offset
 * 
 * We ensure coordinates are properly parsed and rounded to avoid precision issues.
 */
function parseShape(shapeStr: string): XY[] {
  if (!shapeStr || shapeStr.trim() === "") return [];
  return shapeStr
    .trim()
    .split(" ")
    .map((pair) => {
      const parts = pair.split(",");
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      // Round to reasonable precision to avoid floating point issues
      // SUMO typically uses ~2-3 decimal places for coordinates
      return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as XY;
    })
    .filter((xy) => !isNaN(xy[0]) && !isNaN(xy[1]));
}

/**
 * Parse and normalize a single coordinate value.
 */
function parseCoord(value: string | null, defaultValue: number = 0): number {
  if (!value) return defaultValue;
  const n = parseFloat(value);
  return isNaN(n) ? defaultValue : Math.round(n * 1000) / 1000;
}

function parseStringList(str: string): string[] {
  if (!str || str.trim() === "") return [];
  return str.trim().split(/\s+/);
}

function attr(el: Element, name: string, def = ""): string {
  return el.getAttribute(name) ?? def;
}

function numAttr(el: Element, name: string, def = 0): number {
  const v = el.getAttribute(name);
  if (v === null || v === "") return def;
  const n = parseFloat(v);
  return isNaN(n) ? def : n;
}

function intAttr(el: Element, name: string, def = 0): number {
  const v = el.getAttribute(name);
  if (v === null || v === "") return def;
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

/**
 * Convert coordinates using SUMO's coordinate system.
 * In SUMO net.xml, coordinates are stored in "net" coordinate system.
 * This function ensures coordinates are properly interpreted.
 * 
 * Equivalent to sumolib.net.convertXY2LonLat / convertLonLat2XY logic.
 */
function ensureNetCoordinates(
  xy: XY,
  location: SUMOLocation
): XY {
  // Coordinates in XML are already in net coordinate system
  // net_coord = proj_coord + offset
  // So we use them as-is, but ensure they're properly rounded
  return [Math.round(xy[0] * 1000) / 1000, Math.round(xy[1] * 1000) / 1000];
}

function inferEdgeCenterLine(
  lanes: SUMOLane[],
  fromJunction: SUMOJunction | undefined,
  toJunction: SUMOJunction | undefined
): XY[] {
  if (lanes.length === 0) {
    if (fromJunction && toJunction) {
      return [
        [fromJunction.x, fromJunction.y],
        [toJunction.x, toJunction.y],
      ];
    }
    return [];
  }

  const lane0 = lanes[0];
  if (lane0.shape.length < 2) return lane0.shape;

  const laneWidth = lane0.width > 0 ? lane0.width : SUMO_DEFAULT_LANE_WIDTH;
  // SUMO "right" spread: lane 0 lies +0.5 lane width to the right of edge center.
  const inferred = offsetPolyline(lane0.shape, -0.5 * laneWidth);

  if (fromJunction && inferred.length > 0) {
    inferred[0] = [fromJunction.x, fromJunction.y];
  }
  if (toJunction && inferred.length > 0) {
    inferred[inferred.length - 1] = [toJunction.x, toJunction.y];
  }

  return inferred;
}

export function parseNetXML(xmlString: string): SUMONetwork {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");

  // Parse location first - needed for coordinate conversion
  const locEl = doc.querySelector("location");
  const location: SUMOLocation = {
    netOffset: locEl
      ? (attr(locEl, "netOffset")
          .split(",")
          .map((v) => parseCoord(v, 0)) as XY)
      : [0, 0],
    convBoundary: locEl
      ? (attr(locEl, "convBoundary")
          .split(",")
          .map((v) => parseCoord(v, 0)) as [number, number, number, number])
      : [0, 0, 0, 0],
    origBoundary: locEl
      ? (attr(locEl, "origBoundary")
          .split(",")
          .map((v) => parseCoord(v, 0)) as [number, number, number, number])
      : [0, 0, 0, 0],
    projParameter: locEl ? attr(locEl, "projParameter") : "",
  };

  // Parse junctions
  // Coordinates in XML are in "net" coordinate system (net_coord = proj_coord + offset)
  const junctions = new Map<string, SUMOJunction>();
  doc.querySelectorAll("junction").forEach((el) => {
    const id = attr(el, "id");
    const type = attr(el, "type", "priority") as JunctionType;
    if (type === "internal") return; // skip internal junctions for now
    
    // Parse and normalize junction coordinates
    const x = parseCoord(attr(el, "x"), 0);
    const y = parseCoord(attr(el, "y"), 0);
    const z = parseCoord(attr(el, "z"), 0);
    
    // Parse and normalize junction shape
    const shapeStr = attr(el, "shape");
    let shape = parseShape(shapeStr);
    // Ensure shape coordinates are normalized
    shape = shape.map((xy) => ensureNetCoordinates(xy, location));
    
    // If shape is empty or invalid, create a default shape centered at junction position
    // This ensures the junction always has a valid shape
    if (shape.length < 3) {
      const defaultSize = 2.0;
      shape = [
        [x - defaultSize, y - defaultSize],
        [x + defaultSize, y - defaultSize],
        [x + defaultSize, y + defaultSize],
        [x - defaultSize, y + defaultSize],
      ];
    }
    
    junctions.set(id, {
      id,
      type,
      x,
      y,
      z,
      incLanes: parseStringList(attr(el, "incLanes")),
      intLanes: parseStringList(attr(el, "intLanes")),
      shape,
      customShape: false,
    });
  });

  // Parse edges
  const edges = new Map<string, SUMOEdge>();
  doc.querySelectorAll("edge").forEach((el) => {
    const id = attr(el, "id");
    // Skip internal edges (they start with ":")
    if (id.startsWith(":")) return;
    const fromId = attr(el, "from");
    const toId = attr(el, "to");
    const fromJunction = junctions.get(fromId);
    const toJunction = junctions.get(toId);

    const lanes: SUMOLane[] = [];
    el.querySelectorAll("lane").forEach((laneEl) => {
      // Parse and normalize lane shape coordinates
      let laneShape = parseShape(attr(laneEl, "shape"));
      laneShape = laneShape.map((xy) => ensureNetCoordinates(xy, location));
      
      lanes.push({
        id: attr(laneEl, "id"),
        index: intAttr(laneEl, "index"),
        speed: numAttr(laneEl, "speed", 13.89),
        length: numAttr(laneEl, "length"),
        width: numAttr(laneEl, "width", 3.2),
        allow: attr(laneEl, "allow"),
        disallow: attr(laneEl, "disallow"),
        shape: laneShape,
      });
    });

    // Sort lanes by index
    lanes.sort((a, b) => a.index - b.index);

    // Edge shape is either explicit or derived from first lane
    // Ensure coordinates are normalized
    const rawEdgeShape = parseShape(attr(el, "shape"));
    const edgeShape =
      rawEdgeShape.length > 0
        ? rawEdgeShape.map((xy) => ensureNetCoordinates(xy, location))
        : inferEdgeCenterLine(lanes, fromJunction, toJunction);

    edges.set(id, {
      id,
      from: fromId,
      to: toId,
      type: attr(el, "type"),
      priority: intAttr(el, "priority", -1),
      numLanes: lanes.length,
      speed: numAttr(el, "speed", lanes[0]?.speed ?? 13.89),
      spreadType: DEFAULT_SPREAD_TYPE,
      shape: edgeShape,
      lanes,
      allow: attr(el, "allow"),
      disallow: attr(el, "disallow"),
      width: numAttr(el, "width", 3.2),
    });
  });

  // Parse connections
  const connections: SUMOConnection[] = [];
  doc.querySelectorAll("connection").forEach((el) => {
    const from = attr(el, "from");
    // Skip internal connections
    if (from.startsWith(":")) return;
    connections.push({
      from,
      to: attr(el, "to"),
      fromLane: intAttr(el, "fromLane"),
      toLane: intAttr(el, "toLane"),
      via: attr(el, "via"),
      tl: attr(el, "tl"),
      linkIndex: intAttr(el, "linkIndex", -1),
      dir: attr(el, "dir"),
      state: attr(el, "state"),
    });
  });

  // Parse traffic light logics
  const tlLogics: SUMOTLLogic[] = [];
  doc.querySelectorAll("tlLogic").forEach((el) => {
    const phases: TLSPhase[] = [];
    el.querySelectorAll("phase").forEach((phaseEl) => {
      phases.push({
        duration: numAttr(phaseEl, "duration", 30),
        state: attr(phaseEl, "state"),
        minDur: phaseEl.hasAttribute("minDur")
          ? numAttr(phaseEl, "minDur")
          : undefined,
        maxDur: phaseEl.hasAttribute("maxDur")
          ? numAttr(phaseEl, "maxDur")
          : undefined,
      });
    });
    tlLogics.push({
      id: attr(el, "id"),
      type: (attr(el, "type", "static") as TLSType),
      programID: attr(el, "programID", "0"),
      offset: numAttr(el, "offset"),
      phases,
    });
  });

  // Parse roundabouts
  const roundabouts: { nodes: string[]; edges: string[] }[] = [];
  doc.querySelectorAll("roundabout").forEach((el) => {
    roundabouts.push({
      nodes: parseStringList(attr(el, "nodes")),
      edges: parseStringList(attr(el, "edges")),
    });
  });

  return {
    location,
    junctions,
    edges,
    connections,
    tlLogics,
    roundabouts,
  };
}

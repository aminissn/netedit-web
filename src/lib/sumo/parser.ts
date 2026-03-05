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

const DEFAULT_SPREAD_TYPE: SpreadType = "right";

function parseShape(shapeStr: string): XY[] {
  if (!shapeStr || shapeStr.trim() === "") return [];
  return shapeStr
    .trim()
    .split(" ")
    .map((pair) => {
      const parts = pair.split(",");
      return [parseFloat(parts[0]), parseFloat(parts[1])] as XY;
    })
    .filter((xy) => !isNaN(xy[0]) && !isNaN(xy[1]));
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

export function parseNetXML(xmlString: string): SUMONetwork {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");

  // Parse location
  const locEl = doc.querySelector("location");
  const location: SUMOLocation = {
    netOffset: locEl
      ? (attr(locEl, "netOffset")
          .split(",")
          .map(Number) as XY)
      : [0, 0],
    convBoundary: locEl
      ? (attr(locEl, "convBoundary")
          .split(",")
          .map(Number) as [number, number, number, number])
      : [0, 0, 0, 0],
    origBoundary: locEl
      ? (attr(locEl, "origBoundary")
          .split(",")
          .map(Number) as [number, number, number, number])
      : [0, 0, 0, 0],
    projParameter: locEl ? attr(locEl, "projParameter") : "",
  };

  // Parse junctions
  const junctions = new Map<string, SUMOJunction>();
  doc.querySelectorAll("junction").forEach((el) => {
    const id = attr(el, "id");
    const type = attr(el, "type", "priority") as JunctionType;
    if (type === "internal") return; // skip internal junctions for now
    junctions.set(id, {
      id,
      type,
      x: numAttr(el, "x"),
      y: numAttr(el, "y"),
      z: numAttr(el, "z"),
      incLanes: parseStringList(attr(el, "incLanes")),
      intLanes: parseStringList(attr(el, "intLanes")),
      shape: parseShape(attr(el, "shape")),
      customShape: false,
    });
  });

  // Parse edges
  const edges = new Map<string, SUMOEdge>();
  doc.querySelectorAll("edge").forEach((el) => {
    const id = attr(el, "id");
    // Skip internal edges (they start with ":")
    if (id.startsWith(":")) return;

    const lanes: SUMOLane[] = [];
    el.querySelectorAll("lane").forEach((laneEl) => {
      lanes.push({
        id: attr(laneEl, "id"),
        index: intAttr(laneEl, "index"),
        speed: numAttr(laneEl, "speed", 13.89),
        length: numAttr(laneEl, "length"),
        width: numAttr(laneEl, "width", 3.2),
        allow: attr(laneEl, "allow"),
        disallow: attr(laneEl, "disallow"),
        shape: parseShape(attr(laneEl, "shape")),
      });
    });

    // Sort lanes by index
    lanes.sort((a, b) => a.index - b.index);

    // Edge shape is either explicit or derived from first lane
    let edgeShape = parseShape(attr(el, "shape"));
    if (edgeShape.length === 0 && lanes.length > 0) {
      edgeShape = lanes[0].shape;
    }

    edges.set(id, {
      id,
      from: attr(el, "from"),
      to: attr(el, "to"),
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

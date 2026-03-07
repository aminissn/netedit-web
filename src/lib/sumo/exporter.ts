/**
 * Serializes a SUMONetwork back to net.xml format,
 * and exports patch files (nod.xml, edg.xml, con.xml, tll.xml) for incremental netconvert.
 */
import type { SUMONetwork, SUMOConnection } from "./types";

const DEFAULT_SPREAD_TYPE = "right";

function shapeToString(shape: [number, number][]): string {
  return shape.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function exportNetXML(network: SUMONetwork): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("");
  lines.push(
    `<net version="1.16" spreadType="${DEFAULT_SPREAD_TYPE}" junctionCornerDetail="5" limitTurnSpeed="5.50" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/net_file.xsd">`
  );
  lines.push("");

  // Location
  const loc = network.location;
  lines.push(
    `    <location netOffset="${loc.netOffset[0].toFixed(2)},${loc.netOffset[1].toFixed(2)}" convBoundary="${loc.convBoundary.map((v) => v.toFixed(2)).join(",")}" origBoundary="${loc.origBoundary.map((v) => v.toFixed(6)).join(",")}" projParameter="${escapeAttr(loc.projParameter)}"/>`
  );
  lines.push("");

  // Edges and lanes
  network.edges.forEach((edge) => {
    const attrs = [
      `id="${escapeAttr(edge.id)}"`,
      `from="${escapeAttr(edge.from)}"`,
      `to="${escapeAttr(edge.to)}"`,
      `priority="${edge.priority}"`,
    ];
    if (edge.type) attrs.push(`type="${escapeAttr(edge.type)}"`);
    if (edge.numLanes > 1) attrs.push(`numLanes="${edge.numLanes}"`);
    if (edge.speed !== 13.89) attrs.push(`speed="${edge.speed.toFixed(2)}"`);
    attrs.push(`spreadType="${DEFAULT_SPREAD_TYPE}"`);
    if (edge.shape.length > 0) attrs.push(`shape="${shapeToString(edge.shape)}"`);

    lines.push(`    <edge ${attrs.join(" ")}>`);

    for (const lane of edge.lanes) {
      const lAttrs = [
        `id="${escapeAttr(lane.id)}"`,
        `index="${lane.index}"`,
        `speed="${lane.speed.toFixed(2)}"`,
        `length="${lane.length.toFixed(2)}"`,
        `width="${lane.width.toFixed(2)}"`,
      ];
      if (lane.allow) lAttrs.push(`allow="${escapeAttr(lane.allow)}"`);
      if (lane.disallow) lAttrs.push(`disallow="${escapeAttr(lane.disallow)}"`);
      if (lane.shape.length > 0) lAttrs.push(`shape="${shapeToString(lane.shape)}"`);
      lines.push(`        <lane ${lAttrs.join(" ")}/>`);
    }

    lines.push("    </edge>");
  });
  lines.push("");

  // TL logics
  for (const tl of network.tlLogics) {
    lines.push(
      `    <tlLogic id="${escapeAttr(tl.id)}" type="${tl.type}" programID="${escapeAttr(tl.programID)}" offset="${tl.offset}">`
    );
    for (const phase of tl.phases) {
      const pAttrs = [`duration="${phase.duration}"`, `state="${phase.state}"`];
      if (phase.minDur !== undefined) pAttrs.push(`minDur="${phase.minDur}"`);
      if (phase.maxDur !== undefined) pAttrs.push(`maxDur="${phase.maxDur}"`);
      lines.push(`        <phase ${pAttrs.join(" ")}/>`);
    }
    lines.push("    </tlLogic>");
  }
  lines.push("");

  // Junctions
  network.junctions.forEach((junc) => {
    const attrs = [
      `id="${escapeAttr(junc.id)}"`,
      `type="${junc.type}"`,
      `x="${junc.x.toFixed(2)}"`,
      `y="${junc.y.toFixed(2)}"`,
    ];
    if (junc.z !== 0) attrs.push(`z="${junc.z.toFixed(2)}"`);
    if (junc.incLanes.length > 0) attrs.push(`incLanes="${junc.incLanes.join(" ")}"`);
    if (junc.intLanes.length > 0) attrs.push(`intLanes="${junc.intLanes.join(" ")}"`);
    if (junc.shape.length > 0) attrs.push(`shape="${shapeToString(junc.shape)}"`);
    lines.push(`    <junction ${attrs.join(" ")}/>`);
  });
  lines.push("");

  // Connections
  for (const conn of network.connections) {
    const attrs = [
      `from="${escapeAttr(conn.from)}"`,
      `to="${escapeAttr(conn.to)}"`,
      `fromLane="${conn.fromLane}"`,
      `toLane="${conn.toLane}"`,
    ];
    if (conn.via) attrs.push(`via="${escapeAttr(conn.via)}"`);
    if (conn.tl) attrs.push(`tl="${escapeAttr(conn.tl)}"`);
    if (conn.linkIndex >= 0) attrs.push(`linkIndex="${conn.linkIndex}"`);
    if (conn.dir) attrs.push(`dir="${conn.dir}"`);
    if (conn.state) attrs.push(`state="${conn.state}"`);
    lines.push(`    <connection ${attrs.join(" ")}/>`);
  }
  lines.push("");

  // Roundabouts
  for (const rb of network.roundabouts) {
    lines.push(
      `    <roundabout nodes="${rb.nodes.join(" ")}" edges="${rb.edges.join(" ")}"/>`
    );
  }

  lines.push("</net>");
  return lines.join("\n");
}

/**
 * Extract a sub-network around the given dirty edges/nodes.
 * Includes:
 * - All dirty edges and their from/to nodes
 * - All dirty nodes
 * - All other edges connected to any of those nodes (+ their from/to nodes)
 * - Connections that involve any of the included edges
 * - TL logics for any included junctions
 *
 * Returns a standalone net.xml suitable for netconvert processing.
 */
export function extractSubNetwork(
  network: SUMONetwork,
  dirtyEdges: Set<string>,
  dirtyNodes: Set<string>
): { xml: string; nodeIds: Set<string>; edgeIds: Set<string> } {
  // Step 1: Collect seed nodes from dirty edges and dirty nodes
  const nodeIds = new Set<string>(dirtyNodes);
  for (const edgeId of Array.from(dirtyEdges)) {
    const edge = network.edges.get(edgeId);
    if (edge) {
      nodeIds.add(edge.from);
      nodeIds.add(edge.to);
    }
  }

  // Step 2: Collect ALL edges connected to any seed node (1-hop neighborhood)
  const edgeIds = new Set<string>(dirtyEdges);
  network.edges.forEach((edge) => {
    if (nodeIds.has(edge.from) || nodeIds.has(edge.to)) {
      edgeIds.add(edge.id);
    }
  });

  // Step 3: Expand nodes to include from/to of all collected edges
  for (const edgeId of Array.from(edgeIds)) {
    const edge = network.edges.get(edgeId);
    if (edge) {
      nodeIds.add(edge.from);
      nodeIds.add(edge.to);
    }
  }

  // Step 4: Build sub-network XML
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("");
  lines.push(
    `<net version="1.16" spreadType="${DEFAULT_SPREAD_TYPE}" junctionCornerDetail="5" limitTurnSpeed="5.50" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/net_file.xsd">`
  );
  lines.push("");

  // Location (same as full network)
  const loc = network.location;
  lines.push(
    `    <location netOffset="${loc.netOffset[0].toFixed(2)},${loc.netOffset[1].toFixed(2)}" convBoundary="${loc.convBoundary.map((v) => v.toFixed(2)).join(",")}" origBoundary="${loc.origBoundary.map((v) => v.toFixed(6)).join(",")}" projParameter="${escapeAttr(loc.projParameter)}"/>`
  );
  lines.push("");

  // Edges
  for (const edgeId of Array.from(edgeIds)) {
    const edge = network.edges.get(edgeId);
    if (!edge) continue;
    const attrs = [
      `id="${escapeAttr(edge.id)}"`,
      `from="${escapeAttr(edge.from)}"`,
      `to="${escapeAttr(edge.to)}"`,
      `priority="${edge.priority}"`,
    ];
    if (edge.type) attrs.push(`type="${escapeAttr(edge.type)}"`);
    if (edge.numLanes > 1) attrs.push(`numLanes="${edge.numLanes}"`);
    if (edge.speed !== 13.89) attrs.push(`speed="${edge.speed.toFixed(2)}"`);
    attrs.push(`spreadType="${DEFAULT_SPREAD_TYPE}"`);
    if (edge.shape.length > 0) attrs.push(`shape="${shapeToString(edge.shape)}"`);
    lines.push(`    <edge ${attrs.join(" ")}>`);
    for (const lane of edge.lanes) {
      const lAttrs = [
        `id="${escapeAttr(lane.id)}"`,
        `index="${lane.index}"`,
        `speed="${lane.speed.toFixed(2)}"`,
        `length="${lane.length.toFixed(2)}"`,
        `width="${lane.width.toFixed(2)}"`,
      ];
      if (lane.allow) lAttrs.push(`allow="${escapeAttr(lane.allow)}"`);
      if (lane.disallow) lAttrs.push(`disallow="${escapeAttr(lane.disallow)}"`);
      if (lane.shape.length > 0) lAttrs.push(`shape="${shapeToString(lane.shape)}"`);
      lines.push(`        <lane ${lAttrs.join(" ")}/>`);
    }
    lines.push("    </edge>");
  }
  lines.push("");

  // TL logics for included junctions
  for (const tl of network.tlLogics) {
    if (nodeIds.has(tl.id)) {
      lines.push(
        `    <tlLogic id="${escapeAttr(tl.id)}" type="${tl.type}" programID="${escapeAttr(tl.programID)}" offset="${tl.offset}">`
      );
      for (const phase of tl.phases) {
        const pAttrs = [`duration="${phase.duration}"`, `state="${phase.state}"`];
        if (phase.minDur !== undefined) pAttrs.push(`minDur="${phase.minDur}"`);
        if (phase.maxDur !== undefined) pAttrs.push(`maxDur="${phase.maxDur}"`);
        lines.push(`        <phase ${pAttrs.join(" ")}/>`);
      }
      lines.push("    </tlLogic>");
    }
  }
  lines.push("");

  // Junctions
  for (const nodeId of Array.from(nodeIds)) {
    const junc = network.junctions.get(nodeId);
    if (!junc) continue;
    const attrs = [
      `id="${escapeAttr(junc.id)}"`,
      `type="${junc.type}"`,
      `x="${junc.x.toFixed(2)}"`,
      `y="${junc.y.toFixed(2)}"`,
    ];
    if (junc.z !== 0) attrs.push(`z="${junc.z.toFixed(2)}"`);
    if (junc.incLanes.length > 0) attrs.push(`incLanes="${junc.incLanes.join(" ")}"`);
    if (junc.intLanes.length > 0) attrs.push(`intLanes="${junc.intLanes.join(" ")}"`);
    if (junc.shape.length > 0) attrs.push(`shape="${shapeToString(junc.shape)}"`);
    lines.push(`    <junction ${attrs.join(" ")}/>`);
  }
  lines.push("");

  // Connections involving included edges
  for (const conn of network.connections) {
    if (edgeIds.has(conn.from) || edgeIds.has(conn.to)) {
      // Only include if both edges are in the sub-network
      if (edgeIds.has(conn.from) && edgeIds.has(conn.to)) {
        const attrs = [
          `from="${escapeAttr(conn.from)}"`,
          `to="${escapeAttr(conn.to)}"`,
          `fromLane="${conn.fromLane}"`,
          `toLane="${conn.toLane}"`,
        ];
        if (conn.via) attrs.push(`via="${escapeAttr(conn.via)}"`);
        if (conn.tl) attrs.push(`tl="${escapeAttr(conn.tl)}"`);
        if (conn.linkIndex >= 0) attrs.push(`linkIndex="${conn.linkIndex}"`);
        if (conn.dir) attrs.push(`dir="${conn.dir}"`);
        if (conn.state) attrs.push(`state="${conn.state}"`);
        lines.push(`    <connection ${attrs.join(" ")}/>`);
      }
    }
  }
  lines.push("");

  lines.push("</net>");
  return { xml: lines.join("\n"), nodeIds, edgeIds };
}

/**
 * Merge two patch XML files by combining their content.
 * Removes duplicates (keeps the latest version of each element).
 * For connections (which don't have IDs), uses a composite key.
 */
export function mergePatchXML(existingXML: string | null, newXML: string | null, rootTag: string): string | null {
  if (!newXML) return existingXML;
  if (!existingXML) return newXML;

  // Parse both XMLs and extract elements
  const existingParser = new DOMParser();
  const newParser = new DOMParser();
  const existingDoc = existingParser.parseFromString(existingXML, "text/xml");
  const newDoc = newParser.parseFromString(newXML, "text/xml");

  const existingRoot = existingDoc.querySelector(rootTag);
  const newRoot = newDoc.querySelector(rootTag);
  if (!existingRoot || !newRoot) return newXML;

  // Track elements we've seen (from new XML, which takes precedence)
  const seenKeys = new Set<string>();

  // Helper to generate a key for an element
  const getElementKey = (el: Element): string => {
    const id = el.getAttribute("id");
    if (id) return id;
    // For connections, use composite key
    if (el.tagName === "connection" || el.tagName === "delete") {
      const from = el.getAttribute("from") || "";
      const to = el.getAttribute("to") || "";
      const fromLane = el.getAttribute("fromLane") || "";
      const toLane = el.getAttribute("toLane") || "";
      return `${el.tagName}:${from}:${to}:${fromLane}:${toLane}`;
    }
    // Fallback: use all attributes as key
    return Array.from(el.attributes).map(a => `${a.name}=${a.value}`).join("|");
  };

  // First, add all elements from new XML (these take precedence)
  const mergedElements: Element[] = [];
  newRoot.querySelectorAll("*").forEach((el) => {
    const key = getElementKey(el);
    seenKeys.add(key);
    mergedElements.push(el);
  });

  // Then, add elements from existing XML that aren't in new XML
  existingRoot.querySelectorAll("*").forEach((el) => {
    const key = getElementKey(el);
    if (!seenKeys.has(key)) {
      mergedElements.push(el);
    }
  });

  // Build merged XML
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<${rootTag}>`);
  mergedElements.forEach((el) => {
    const attrs: string[] = [];
    Array.from(el.attributes).forEach((attr) => {
      attrs.push(`${attr.name}="${escapeAttr(attr.value)}"`);
    });
    const tagName = el.tagName;
    if (el.childElementCount === 0) {
      lines.push(`    <${tagName} ${attrs.join(" ")}/>`);
    } else {
      lines.push(`    <${tagName} ${attrs.join(" ")}>`);
      el.querySelectorAll("*").forEach((child) => {
        const childAttrs: string[] = [];
        Array.from(child.attributes).forEach((attr) => {
          childAttrs.push(`${attr.name}="${escapeAttr(attr.value)}"`);
        });
        lines.push(`        <${child.tagName} ${childAttrs.join(" ")}/>`);
      });
      lines.push(`    </${tagName}>`);
    }
  });
  lines.push(`</${rootTag}>`);
  return lines.join("\n");
}

/**
 * Export a .nod.xml patch containing only the specified dirty junctions.
 * Can merge with existing patch XML.
 */
export function exportPatchNodXML(
  network: SUMONetwork,
  dirtyNodeIds: Set<string>,
  existingPatchXML?: string | null
): string | null {
  if (dirtyNodeIds.size === 0) return existingPatchXML || null;
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<nodes>');
  for (const id of Array.from(dirtyNodeIds)) {
    const junc = network.junctions.get(id);
    if (!junc) {
      // Node was deleted — emit a delete directive
      lines.push(`    <delete id="${escapeAttr(id)}"/>`);
      continue;
    }
    const attrs = [
      `id="${escapeAttr(junc.id)}"`,
      `x="${junc.x.toFixed(2)}"`,
      `y="${junc.y.toFixed(2)}"`,
      `type="${junc.type}"`,
    ];
    if (junc.z !== 0) attrs.push(`z="${junc.z.toFixed(2)}"`);
    lines.push(`    <node ${attrs.join(" ")}/>`);
  }
  lines.push('</nodes>');
  const newXML = lines.join("\n");
  return mergePatchXML(existingPatchXML, newXML, "nodes");
}

/**
 * Export a .edg.xml patch containing only the specified dirty edges.
 * Can merge with existing patch XML.
 */
export function exportPatchEdgXML(
  network: SUMONetwork,
  dirtyEdgeIds: Set<string>,
  existingPatchXML?: string | null
): string | null {
  if (dirtyEdgeIds.size === 0) return existingPatchXML || null;
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<edges>');
  for (const id of Array.from(dirtyEdgeIds)) {
    const edge = network.edges.get(id);
    if (!edge) {
      lines.push(`    <delete id="${escapeAttr(id)}"/>`);
      continue;
    }
    const attrs = [
      `id="${escapeAttr(edge.id)}"`,
      `from="${escapeAttr(edge.from)}"`,
      `to="${escapeAttr(edge.to)}"`,
      `numLanes="${edge.numLanes}"`,
      `speed="${edge.speed.toFixed(2)}"`,
      `priority="${edge.priority}"`,
      `spreadType="${DEFAULT_SPREAD_TYPE}"`,
    ];
    if (edge.type) attrs.push(`type="${escapeAttr(edge.type)}"`);
    if (edge.allow) attrs.push(`allow="${escapeAttr(edge.allow)}"`);
    if (edge.disallow) attrs.push(`disallow="${escapeAttr(edge.disallow)}"`);
    if (edge.shape.length > 0) attrs.push(`shape="${shapeToString(edge.shape)}"`);
    lines.push(`    <edge ${attrs.join(" ")}/>`);
  }
  lines.push('</edges>');
  const newXML = lines.join("\n");
  return mergePatchXML(existingPatchXML, newXML, "edges");
}

interface ConnectionEntry {
  from: string;
  to: string;
  fromLane: number;
  toLane: number;
}

/**
 * Export a .con.xml patch containing only relevant changes:
 * - All connections from and to edges whose numLanes changed (with both from and to edge IDs)
 * - Explicitly added connections
 * - Explicitly removed connections (with remove="true")
 * Can merge with existing patch XML.
 */
export function exportPatchConXML(
  resetEdges: Set<string>,
  resetConnectionSnapshots: Map<string, { from: string; to: string }[]>,
  addedConnections: ConnectionEntry[],
  removedConnections: ConnectionEntry[],
  network: SUMONetwork,
  existingPatchXML?: string | null
): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<connections>');

  // Write all connections from and to edges with numLanes changes
  // Each connection must contain both from and to edge IDs with reset="true"
  // Use snapshots captured before connections were removed
  const writtenConnections = new Set<string>();
  for (const edgeId of Array.from(resetEdges)) {
    // First try to use captured snapshot (connections before removal)
    const snapshot = resetConnectionSnapshots.get(edgeId);
    if (snapshot && snapshot.length > 0) {
      for (const conn of snapshot) {
        const key = `${conn.from}-${conn.to}`;
        if (!writtenConnections.has(key)) {
          lines.push(`    <connection from="${escapeAttr(conn.from)}" to="${escapeAttr(conn.to)}" reset="true"/>`);
          writtenConnections.add(key);
        }
      }
    } else {
      // Fallback: try to find in current network (in case connections weren't removed yet)
      for (const conn of network.connections) {
        if (conn.from === edgeId || conn.to === edgeId) {
          const key = `${conn.from}-${conn.to}`;
          if (!writtenConnections.has(key)) {
            lines.push(`    <connection from="${escapeAttr(conn.from)}" to="${escapeAttr(conn.to)}" reset="true"/>`);
            writtenConnections.add(key);
          }
        }
      }
    }
  }

  // Explicitly removed connections
  for (const conn of removedConnections) {
    lines.push(`    <connection from="${escapeAttr(conn.from)}" to="${escapeAttr(conn.to)}" fromLane="${conn.fromLane}" toLane="${conn.toLane}" remove="true"/>`);
  }

  // Explicitly added connections
  for (const conn of addedConnections) {
    lines.push(`    <connection from="${escapeAttr(conn.from)}" to="${escapeAttr(conn.to)}" fromLane="${conn.fromLane}" toLane="${conn.toLane}"/>`);
  }

  lines.push('</connections>');
  const newXML = lines.join("\n");
  return mergePatchXML(existingPatchXML, newXML, "connections") || newXML;
}

/**
 * Export a .con.xml containing only connections that exist in computedNetwork
 * but not in baseNetwork. Used to pass newly computed connections back to netconvert
 * for TLS regeneration.
 */
export function exportNewConnectionsXML(
  baseNetwork: SUMONetwork,
  computedNetwork: SUMONetwork
): string | null {
  // Build a set of connection keys from base network
  const baseConnKeys = new Set<string>();
  for (const conn of baseNetwork.connections) {
    const key = `${conn.from}:${conn.fromLane}-${conn.to}:${conn.toLane}`;
    baseConnKeys.add(key);
  }

  // Find connections in computed that aren't in base
  const newConnections: SUMOConnection[] = [];
  for (const conn of computedNetwork.connections) {
    const key = `${conn.from}:${conn.fromLane}-${conn.to}:${conn.toLane}`;
    if (!baseConnKeys.has(key)) {
      newConnections.push(conn);
    }
  }

  if (newConnections.length === 0) return null;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<connections>");

  for (const conn of newConnections) {
    const attrs = [
      `from="${escapeAttr(conn.from)}"`,
      `to="${escapeAttr(conn.to)}"`,
      `fromLane="${conn.fromLane}"`,
      `toLane="${conn.toLane}"`,
    ];
    if (conn.via) attrs.push(`via="${escapeAttr(conn.via)}"`);
    if (conn.tl) attrs.push(`tl="${escapeAttr(conn.tl)}"`);
    if (conn.linkIndex >= 0) attrs.push(`linkIndex="${conn.linkIndex}"`);
    if (conn.dir) attrs.push(`dir="${conn.dir}"`);
    if (conn.state) attrs.push(`state="${escapeAttr(conn.state)}"`);
    lines.push(`    <connection ${attrs.join(" ")}/>`);
  }

  lines.push("</connections>");
  return lines.join("\n");
}

/**
 * Export a .tll.xml patch containing only the specified dirty TLS programs.
 * Can merge with existing patch XML.
 */
export function exportPatchTllXML(
  network: SUMONetwork,
  dirtyTLSIds: Set<string>,
  existingPatchXML?: string | null
): string | null {
  if (dirtyTLSIds.size === 0) return existingPatchXML || null;
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<tlLogics>');
  for (const id of Array.from(dirtyTLSIds)) {
    const tls = network.tlLogics.find((t) => t.id === id);
    if (!tls) {
      // TLS was removed — netconvert will handle based on junction type
      lines.push(`    <delete id="${escapeAttr(id)}"/>`);
      continue;
    }
    lines.push(
      `    <tlLogic id="${escapeAttr(tls.id)}" type="${tls.type}" programID="${escapeAttr(tls.programID)}" offset="${tls.offset}">`
    );
    for (const phase of tls.phases) {
      const pAttrs = [`duration="${phase.duration}"`, `state="${phase.state}"`];
      if (phase.minDur !== undefined) pAttrs.push(`minDur="${phase.minDur}"`);
      if (phase.maxDur !== undefined) pAttrs.push(`maxDur="${phase.maxDur}"`);
      lines.push(`        <phase ${pAttrs.join(" ")}/>`);
    }
    lines.push("    </tlLogic>");
  }
  lines.push('</tlLogics>');
  const newXML = lines.join("\n");
  return mergePatchXML(existingPatchXML, newXML, "tlLogics");
}

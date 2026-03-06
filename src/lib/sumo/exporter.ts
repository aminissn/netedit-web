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
 * Export a .nod.xml patch containing only the specified dirty junctions.
 */
export function exportPatchNodXML(
  network: SUMONetwork,
  dirtyNodeIds: Set<string>
): string | null {
  if (dirtyNodeIds.size === 0) return null;
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
  return lines.join("\n");
}

/**
 * Export a .edg.xml patch containing only the specified dirty edges.
 */
export function exportPatchEdgXML(
  network: SUMONetwork,
  dirtyEdgeIds: Set<string>
): string | null {
  if (dirtyEdgeIds.size === 0) return null;
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
  return lines.join("\n");
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
 */
export function exportPatchConXML(
  resetEdges: Set<string>,
  resetConnectionSnapshots: Map<string, { from: string; to: string }[]>,
  addedConnections: ConnectionEntry[],
  removedConnections: ConnectionEntry[],
  network: SUMONetwork
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
  return lines.join("\n");
}

/**
 * Export a .tll.xml patch containing only the specified dirty TLS programs.
 */
export function exportPatchTllXML(
  network: SUMONetwork,
  dirtyTLSIds: Set<string>
): string | null {
  if (dirtyTLSIds.size === 0) return null;
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
  return lines.join("\n");
}

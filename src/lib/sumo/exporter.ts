/**
 * Serializes a SUMONetwork back to net.xml format.
 */
import type { SUMONetwork } from "./types";

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

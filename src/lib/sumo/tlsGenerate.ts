/**
 * Port of NBOwnTLDef: generates default fixed-time traffic light signal plans.
 * Simplified version that creates reasonable phase plans for junctions.
 */
import type { SUMONetwork, SUMOTLLogic, TLSPhase, SUMOConnection } from "./types";

const GREEN_TIME = 31;
const YELLOW_TIME = 4;
const ALL_RED_TIME = 2;
const MIN_GREEN = 5;

/**
 * Generate a default TLS program for a junction.
 * Groups connections by approach direction and creates green phases for each group.
 */
export function generateTLSProgram(
  junctionId: string,
  network: SUMONetwork
): SUMOTLLogic {
  // Find all connections controlled by this TLS
  const connections = network.connections.filter(
    (c) => {
      const fromEdge = network.edges.get(c.from);
      const toEdge = network.edges.get(c.to);
      return fromEdge && toEdge && (fromEdge.to === junctionId || toEdge.from === junctionId);
    }
  );

  // If no connections, create a simple all-green phase
  if (connections.length === 0) {
    return {
      id: junctionId,
      type: "static",
      programID: "0",
      offset: 0,
      phases: [{ duration: GREEN_TIME, state: "G" }],
    };
  }

  // Group connections by incoming edge
  const groups = new Map<string, SUMOConnection[]>();
  for (const conn of connections) {
    const key = conn.from;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(conn);
  }

  const numLinks = connections.length;
  const phases: TLSPhase[] = [];

  // Find opposing edges (edges going in roughly opposite directions)
  const edgeEntries = Array.from(groups.entries());
  const processed = new Set<string>();

  for (const [edgeId, conns] of edgeEntries) {
    if (processed.has(edgeId)) continue;
    processed.add(edgeId);

    // Find opposing edge
    const fromEdge = network.edges.get(edgeId);
    if (!fromEdge) continue;

    let opposingId: string | null = null;
    for (const [otherEdgeId] of edgeEntries) {
      if (otherEdgeId === edgeId || processed.has(otherEdgeId)) continue;
      const otherEdge = network.edges.get(otherEdgeId);
      if (!otherEdge) continue;
      // Opposing if they connect to/from the same junction but from opposite sides
      if (otherEdge.to === fromEdge.from && otherEdge.from === fromEdge.to) {
        opposingId = otherEdgeId;
        break;
      }
    }

    if (opposingId) {
      processed.add(opposingId);
    }

    // Create green phase for this direction pair
    const greenState = new Array(numLinks).fill("r");
    for (let i = 0; i < connections.length; i++) {
      if (connections[i].from === edgeId || (opposingId && connections[i].from === opposingId)) {
        greenState[i] = "G";
      }
    }

    // Create yellow phase
    const yellowState = greenState.map((s) => (s === "G" ? "y" : "r"));

    phases.push({ duration: GREEN_TIME, state: greenState.join("") });
    phases.push({ duration: YELLOW_TIME, state: yellowState.join("") });

    // All-red phase
    if (ALL_RED_TIME > 0) {
      phases.push({
        duration: ALL_RED_TIME,
        state: new Array(numLinks).fill("r").join(""),
      });
    }
  }

  // If we ended up with no phases, create a default
  if (phases.length === 0) {
    phases.push({
      duration: GREEN_TIME,
      state: new Array(numLinks).fill("G").join(""),
    });
  }

  return {
    id: junctionId,
    type: "static",
    programID: "0",
    offset: 0,
    phases,
  };
}

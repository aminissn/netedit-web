"use client";

import React from "react";
import { useUIStore } from "@/store/uiStore";
import { useNetworkStore } from "@/store/networkStore";
import type { JunctionType } from "@/lib/sumo/types";
import ConnectionEditor from "./ConnectionEditor";
import TLSEditor from "./TLSEditor";

const JUNCTION_TYPES: JunctionType[] = [
  "priority",
  "traffic_light",
  "right_before_left",
  "unregulated",
  "dead_end",
  "allway_stop",
  "priority_stop",
];

export default function InspectorPanel() {
  const selection = useUIStore((s) => s.selection);
  const editMode = useUIStore((s) => s.editMode);
  const drawSubMode = useUIStore((s) => s.drawSubMode);
  const setSelection = useUIStore((s) => s.setSelection);
  const network = useNetworkStore((s) => s.network);
  const doRemoveJunction = useNetworkStore((s) => s.doRemoveJunction);
  const doRemoveEdge = useNetworkStore((s) => s.doRemoveEdge);
  const doRemoveConnection = useNetworkStore((s) => s.doRemoveConnection);

  if (!selection || !network) return null;

  if (editMode === "draw" && drawSubMode === "connection" && selection.type === "junction") {
    return <ConnectionEditor junctionId={selection.id} />;
  }

  // Show TLS editor if junction is a traffic light (in any mode)
  if (selection.type === "junction") {
    const junction = network.junctions.get(selection.id);
    if (junction && junction.type === "traffic_light") {
      return <TLSEditor junctionId={selection.id} />;
    }
  }

  const handleDelete = () => {
    if (!selection) return;
    switch (selection.type) {
      case "junction":
        doRemoveJunction(selection.id);
        break;
      case "edge":
        doRemoveEdge(selection.id);
        break;
      case "connection": {
        // Parse connection ID: "from_fromLane-to_toLane"
        const parts = selection.id.split("-");
        if (parts.length === 2) {
          const [fromPart, toPart] = parts;
          const fromMatch = fromPart.match(/^(.+)_(\d+)$/);
          const toMatch = toPart.match(/^(.+)_(\d+)$/);
          if (fromMatch && toMatch) {
            const [, from, fromLane] = fromMatch;
            const [, to, toLane] = toMatch;
            doRemoveConnection(from, to, parseInt(fromLane), parseInt(toLane));
          }
        }
        break;
      }
    }
    setSelection(null);
  };

  return (
    <div className="absolute right-2 top-16 z-10 w-72 bg-gray-800/95 rounded-lg shadow-lg backdrop-blur-sm overflow-hidden">
      <div className="px-3 py-2 bg-gray-700 text-sm font-semibold text-gray-200 border-b border-gray-600 flex items-center justify-between">
        <span>
          {selection.type.charAt(0).toUpperCase() + selection.type.slice(1)}: {selection.id}
        </span>
        <button
          onClick={handleDelete}
          className="px-2 py-1 text-xs bg-red-700/80 text-red-100 rounded hover:bg-red-600 transition-colors"
          title="Delete selected object"
        >
          Delete
        </button>
      </div>
      <div className="p-3 space-y-2 max-h-[60vh] overflow-y-auto text-sm">
        {selection.type === "junction" && <JunctionInspector id={selection.id} />}
        {selection.type === "edge" && <EdgeInspector id={selection.id} />}
        {selection.type === "lane" && (
          <LaneInspector laneId={selection.id} edgeId={selection.subId} />
        )}
        {selection.type === "connection" && (
          <div className="text-gray-400 text-xs">
            Connection: {selection.id}
          </div>
        )}
      </div>
    </div>
  );
}

function JunctionInspector({ id }: { id: string }) {
  const network = useNetworkStore((s) => s.network);
  const doSetJunctionType = useNetworkStore((s) => s.doSetJunctionType);
  const doMoveJunction = useNetworkStore((s) => s.doMoveJunction);
  const junction = network?.junctions.get(id);
  if (!junction) return <div className="text-gray-400">Junction not found</div>;

  return (
    <>
      <Field label="ID" value={junction.id} />
      <div className="flex items-center justify-between">
        <span className="text-gray-400">Type</span>
        <select
          value={junction.type}
          onChange={(e) => doSetJunctionType(id, e.target.value as JunctionType)}
          className="bg-gray-700 text-white text-xs px-2 py-1 rounded border border-gray-600"
        >
          {JUNCTION_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <EditableField
        label="X"
        value={junction.x.toFixed(2)}
        onChange={(v) => {
          const x = Number(v);
          if (Number.isFinite(x)) {
            doMoveJunction(id, x, junction.y);
          }
        }}
        type="number"
      />
      <EditableField
        label="Y"
        value={junction.y.toFixed(2)}
        onChange={(v) => {
          const y = Number(v);
          if (Number.isFinite(y)) {
            doMoveJunction(id, junction.x, y);
          }
        }}
        type="number"
      />
      <Field label="Incoming lanes" value={junction.incLanes.length.toString()} />
    </>
  );
}

function EdgeInspector({ id }: { id: string }) {
  const network = useNetworkStore((s) => s.network);
  const doSetEdgeAttribute = useNetworkStore((s) => s.doSetEdgeAttribute);

  // Extract edge ID from lane ID if needed (e.g., "E_1_0" → "E_1")
  const edge = network?.edges.get(id);
  if (!edge) return <div className="text-gray-400">Edge not found</div>;

  return (
    <>
      <Field label="ID" value={edge.id} />
      <Field label="From" value={edge.from} />
      <Field label="To" value={edge.to} />
      <EditableField
        label="Lanes"
        value={edge.numLanes.toString()}
        onChange={(v) => doSetEdgeAttribute(edge.id, "numLanes", parseInt(v))}
        type="number"
      />
      <EditableField
        label="Speed"
        value={edge.speed.toFixed(2)}
        onChange={(v) => doSetEdgeAttribute(edge.id, "speed", parseFloat(v))}
        type="number"
      />
      <EditableField
        label="Priority"
        value={edge.priority.toString()}
        onChange={(v) => doSetEdgeAttribute(edge.id, "priority", parseInt(v))}
        type="number"
      />
      <EditableField
        label="Type"
        value={edge.type}
        onChange={(v) => doSetEdgeAttribute(edge.id, "type", v)}
      />
      <EditableField
        label="Allow"
        value={edge.allow}
        onChange={(v) => doSetEdgeAttribute(edge.id, "allow", v)}
      />
      <EditableField
        label="Disallow"
        value={edge.disallow}
        onChange={(v) => doSetEdgeAttribute(edge.id, "disallow", v)}
      />
      <Field label="Spread" value="right" />
      <Field label="Length" value={edge.lanes[0]?.length.toFixed(2) ?? "0"} />
    </>
  );
}

function LaneInspector({ laneId, edgeId }: { laneId: string; edgeId?: string }) {
  const network = useNetworkStore((s) => s.network);
  const doSetLaneAttribute = useNetworkStore((s) => s.doSetLaneAttribute);
  const doSetEdgeAttribute = useNetworkStore((s) => s.doSetEdgeAttribute);

  let edge = edgeId ? network?.edges.get(edgeId) : undefined;
  if (!edge && network) {
    for (const candidate of Array.from(network.edges.values())) {
      if (candidate.lanes.some((l) => l.id === laneId)) {
        edge = candidate;
        break;
      }
    }
  }
  const lane = edge?.lanes.find((l) => l.id === laneId);
  if (!lane || !edge) return <div className="text-gray-400">Lane not found</div>;

  return (
    <>
      <Field label="ID" value={lane.id} />
      <Field label="Edge" value={edge.id} />
      <EditableField
        label="Lanes"
        value={edge.numLanes.toString()}
        onChange={(v) => doSetEdgeAttribute(edge.id, "numLanes", parseInt(v))}
        type="number"
      />
      <Field label="Index" value={lane.index.toString()} />
      <EditableField
        label="Speed"
        value={lane.speed.toFixed(2)}
        onChange={(v) => doSetLaneAttribute(lane.id, "speed", Number(v))}
        type="number"
      />
      <EditableField
        label="Width"
        value={lane.width.toFixed(2)}
        onChange={(v) => doSetLaneAttribute(lane.id, "width", Number(v))}
        type="number"
      />
      <EditableField
        label="Allow"
        value={lane.allow}
        onChange={(v) => doSetLaneAttribute(lane.id, "allow", v)}
      />
      <EditableField
        label="Disallow"
        value={lane.disallow}
        onChange={(v) => doSetLaneAttribute(lane.id, "disallow", v)}
      />
      <Field label="Length" value={lane.length.toFixed(2)} />
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-200 font-mono text-xs">{value}</span>
    </div>
  );
}

function EditableField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  if (!editing) {
    return (
      <div
        className="flex items-center justify-between cursor-pointer hover:bg-gray-700/50 rounded px-1 -mx-1"
        onClick={() => setEditing(true)}
      >
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-200 font-mono text-xs">{value || "(empty)"}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <input
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onChange(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setEditing(false);
            if (draft !== value) onChange(draft);
          }
          if (e.key === "Escape") {
            setEditing(false);
            setDraft(value);
          }
        }}
        autoFocus
        className="bg-gray-700 text-white text-xs px-2 py-1 rounded border border-blue-500 w-24 outline-none"
      />
    </div>
  );
}

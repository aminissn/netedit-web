declare module "@deck.gl/react" {
  import { ComponentType } from "react";
  const DeckGL: ComponentType<any>;
  export default DeckGL;
}

declare module "@deck.gl/layers" {
  export class PathLayer<D = any> {
    constructor(props: any);
  }
  export class PolygonLayer<D = any> {
    constructor(props: any);
  }
  export class ScatterplotLayer<D = any> {
    constructor(props: any);
  }
}

declare module "@deck.gl/core" {
  export interface MapViewState {
    longitude: number;
    latitude: number;
    zoom: number;
    pitch?: number;
    bearing?: number;
  }
  export interface PickingInfo {
    object?: any;
    layer?: { id: string } | null;
    coordinate?: number[];
    x?: number;
    y?: number;
  }
}

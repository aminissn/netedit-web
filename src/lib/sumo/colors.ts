/** RGBA color constants matching netedit's palette */
export type RGBA = [number, number, number, number];

export const COLORS = {
  edge: [64, 64, 64, 200] as RGBA,
  lane: [100, 100, 100, 220] as RGBA,
  laneSelected: [0, 128, 255, 255] as RGBA,
  laneHover: [80, 140, 200, 220] as RGBA,

  junction: [50, 50, 50, 220] as RGBA,
  junctionSelected: [0, 128, 255, 200] as RGBA,
  junctionHover: [80, 80, 120, 220] as RGBA,

  connection: [255, 215, 0, 150] as RGBA,
  connectionSelected: [0, 255, 128, 200] as RGBA,
  connectionHover: [255, 255, 128, 180] as RGBA,

  geometryPoint: [255, 0, 128, 200] as RGBA,
  geometryPointHover: [255, 100, 180, 255] as RGBA,

  newEdgePreview: [0, 255, 0, 180] as RGBA,
  deleteHighlight: [255, 0, 0, 200] as RGBA,

  trafficLight: [255, 255, 0, 200] as RGBA,

  // TLS phase colors
  tlsGreen: [0, 255, 0, 255] as RGBA,
  tlsYellow: [255, 255, 0, 255] as RGBA,
  tlsRed: [255, 0, 0, 255] as RGBA,
  tlsGreenDim: [0, 200, 0, 200] as RGBA,
  tlsYellowDim: [200, 200, 0, 200] as RGBA,
  tlsRedDim: [200, 0, 0, 200] as RGBA,
  tlsOff: [100, 100, 100, 150] as RGBA,

  // Lane permission colors
  lanePermissionPedestrian: [153, 217, 234, 200] as RGBA,
  lanePermissionBicycle: [0, 128, 0, 200] as RGBA,
  lanePermissionBus: [255, 165, 0, 200] as RGBA,
} as const;

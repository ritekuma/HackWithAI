import { MissionEngine } from "./engine";

let _engine: MissionEngine | null = null;

export function getMissionEngine(): MissionEngine {
  if (!_engine) _engine = new MissionEngine();
  return _engine;
}

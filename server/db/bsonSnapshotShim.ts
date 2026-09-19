import { startupSnapshot } from "node:v8";

const snapshotProbeWorks = (): boolean => {
  try {
    startupSnapshot.isBuildingSnapshot();
    return true;
  } catch {
    return false;
  }
};

if (!snapshotProbeWorks()) {
  startupSnapshot.isBuildingSnapshot = () => false;
}

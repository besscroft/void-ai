import {
  createRuntimeRun,
  createRuntimeStep,
  insertRuntimeEvent,
  updateRuntimeRun,
  updateRuntimeStep,
} from "./db";

export const recordRuntimeRun = createRuntimeRun;
export const recordRuntimeStep = createRuntimeStep;
export const recordRuntimeEvent = insertRuntimeEvent;
export const updateRecordedRuntimeRun = updateRuntimeRun;
export const updateRecordedRuntimeStep = updateRuntimeStep;

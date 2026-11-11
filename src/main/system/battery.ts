import { clamp, isRecord } from './guards';
import type { PowerShellRunner } from './powershell';
import { SystemError, type BatteryInfo, type SystemApi } from './types';

export type BatteryApi = Pick<SystemApi, 'getBattery'>;

/** Win32_Battery.BatteryStatus: 1 discharging, 4 low, 5 critical. */
const DISCHARGING_STATUSES: ReadonlySet<number> = new Set([1, 4, 5]);
/** 6 charging, 7 charging and high, 8 charging and low, 9 charging and critical. */
const CHARGING_STATUSES: ReadonlySet<number> = new Set([6, 7, 8, 9]);
/** EstimatedRunTime reports 0x4444444 minutes while the time is unknown (e.g. on AC power). */
const UNKNOWN_RUN_TIME = 71_582_788;

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * Interprets the raw values of battery.ps1. The ACPI flags (Charging / PowerOnline) are authoritative
 * when present; otherwise the BatteryStatus code decides ("2: on AC" cannot tell charging apart).
 */
export function parseBattery(data: unknown): BatteryInfo {
  if (!isRecord(data) || typeof data.hasBattery !== 'boolean') {
    throw new SystemError('failed', 'The battery helper returned an unexpected reply.');
  }
  if (!data.hasBattery) return { hasBattery: false, charging: false, onAc: true };

  const status = numberOrNull(data.status);
  const percent = numberOrNull(data.percent);
  const discharging = status !== null && DISCHARGING_STATUSES.has(status);
  const charging =
    booleanOrNull(data.charging) ?? (status !== null && CHARGING_STATUSES.has(status));
  const onAc = booleanOrNull(data.powerOnline) ?? !discharging;

  const runTime = numberOrNull(data.runTimeMinutes);
  const minutesRemaining =
    !onAc && runTime !== null && runTime > 0 && runTime < UNKNOWN_RUN_TIME
      ? Math.round(runTime)
      : undefined;

  return {
    hasBattery: true,
    ...(percent === null ? {} : { percent: clamp(Math.round(percent), 0, 100) }),
    charging,
    onAc,
    ...(minutesRemaining === undefined ? {} : { minutesRemaining }),
  };
}

export function createBatteryApi(runner: PowerShellRunner): BatteryApi {
  return {
    async getBattery() {
      return parseBattery(await runner.run('battery'));
    },
  };
}

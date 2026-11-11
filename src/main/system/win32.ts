/**
 * Loading koffi (the native FFI used for the few Win32 calls dictation needs). The module is
 * loaded lazily so a missing or blocked native binary never prevents the app from starting.
 */

/** The slice of the koffi API the Win32 helpers use (keeps the native module out of the types). */
export interface KoffiLike {
  load(library: string): { func(definition: string): unknown };
}

export type KoffiLoader = () => Promise<KoffiLike>;

export const loadKoffi: KoffiLoader = async () => {
  const module = (await import('koffi')) as unknown as KoffiLike & { default?: KoffiLike };
  return module.default ?? module;
};

/** Handles are 32-bit significant on 64-bit Windows, so a JS number holds them exactly. */
export function readHandle(buffer: Buffer, offset: number): number {
  return Number(buffer.readBigUInt64LE(offset));
}

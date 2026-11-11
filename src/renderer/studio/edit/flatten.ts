import type { Size } from '@shared/geometry';
import { paintEdit } from './draw';
import type { EditState } from './types';

/** PNG bytes as the IPC schema wants them (a plain ArrayBuffer behind the view). */
export type PngBytes = Uint8Array<ArrayBuffer>;

/** Turns the picture and its edits into the bytes of a PNG at the picture's native resolution. */
export type Flattener = (
  source: CanvasImageSource,
  size: Size,
  state: EditState,
) => Promise<PngBytes>;

/** Size of the result: the crop, or the whole picture. */
export function outputSize(size: Size, state: EditState): Size {
  return state.crop
    ? { width: state.crop.width, height: state.crop.height }
    : { width: size.width, height: size.height };
}

export const flattenToPng: Flattener = async (source, size, state) => {
  const output = outputSize(size, state);
  const canvas = document.createElement('canvas');
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The picture could not be drawn.');
  paintEdit(
    context,
    source,
    state,
    state.crop ?? { x: 0, y: 0, width: size.width, height: size.height },
    1,
  );
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The picture could not be saved.');
  return new Uint8Array(await blob.arrayBuffer());
};

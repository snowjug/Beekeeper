import type { CSSProperties } from 'react';

const BLOBS = [
  {
    drift: 'ob-drift-a',
    color: 'var(--bk-honey)',
    box: { width: 480, height: 480, left: -150, top: -170 },
  },
  {
    drift: 'ob-drift-b',
    color: 'var(--bk-violet)',
    box: { width: 560, height: 560, right: -190, top: -120 },
  },
  {
    drift: 'ob-drift-c',
    color: 'var(--bk-coral)',
    box: { width: 460, height: 460, left: 90, bottom: -230 },
  },
  {
    drift: 'ob-drift-d',
    color: 'var(--bk-cyan)',
    box: { width: 500, height: 500, right: -120, bottom: -210 },
  },
] as const;

/**
 * Calm ambient light: four soft brand-coloured radial gradients that drift slowly. Only transforms
 * animate (compositor thread); with reduced motion the blobs just sit still.
 */
export function AmbientBackground({ animated }: { animated: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {BLOBS.map((blob) => {
        const style: CSSProperties & Record<'--ob-blob', string> = {
          ...blob.box,
          '--ob-blob': blob.color,
        };
        return (
          <span
            key={blob.drift}
            className={`ob-blob ${animated ? blob.drift : ''}`}
            style={style}
          />
        );
      })}
    </div>
  );
}

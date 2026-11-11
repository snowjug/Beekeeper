import { useController, useStudio, useViewport } from './context';
import { EditorStage } from './EditorStage';
import { FrameShell } from './FrameShell';
import { fitImage } from './layout';
import { RedactionBar, RedactionLayer } from './Redaction';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';

/** Room for the pills above the picture and the toolbar below it (CSS pixels). */
const RESERVE_TOP = 76;
const RESERVE_BOTTOM = 104;

/** The picture in its glowing frame with the pills above and the toolbar below; the editor takes over while editing. */
export function Stage() {
  const controller = useController();
  const session = useStudio((state) => state.session);
  const imageUrl = useStudio((state) => state.imageUrl);
  const imageSize = useStudio((state) => state.imageSize);
  const mode = useStudio((state) => state.mode);
  const redaction = useStudio((state) => state.redaction.status);
  const viewport = useViewport();
  if (!session || !imageUrl || !imageSize) return null;

  const image = controller.currentImage;
  if (mode === 'edit' && image) return <EditorStage image={image} size={imageSize} />;

  const fit = fitImage(imageSize, viewport, {
    reserveTop: RESERVE_TOP,
    reserveBottom: RESERVE_BOTTOM,
    scaleFactor: session.scaleFactor,
  });
  const reviewing = redaction !== 'idle';

  // The empty area stays click-through to the dimmed backdrop, which closes the preview.
  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-5 px-6"
      data-testid="studio-stage"
    >
      <div className="pointer-events-auto" style={{ width: fit.width }}>
        {reviewing ? <RedactionBar /> : <TopBar />}
      </div>
      <div className="pointer-events-auto">
        <FrameShell width={fit.width} height={fit.height} glow={session.glowFrame}>
          <img
            src={imageUrl}
            alt="Your screenshot"
            draggable={false}
            data-testid="studio-image"
            className="h-full w-full object-fill select-none"
          />
          <RedactionLayer scale={fit.scale} />
        </FrameShell>
      </div>
      <div className="pointer-events-auto">
        <Toolbar disabled={reviewing} />
      </div>
    </div>
  );
}

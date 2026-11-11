import { Button } from '@renderer/components/Button';
import { useController } from '../../context';

/** Opens the Windows "Microphone privacy" page. */
export function OpenMicSettingsButton() {
  const controller = useController();
  return (
    <Button
      size="sm"
      icon="external"
      onClick={() =>
        void controller.run('Could not open Windows settings', (bridge) =>
          bridge.invoke('os:openMicSettings'),
        )
      }
    >
      Open Windows microphone settings
    </Button>
  );
}

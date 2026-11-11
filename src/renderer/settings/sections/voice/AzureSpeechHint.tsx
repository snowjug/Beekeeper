import { useController, useView } from '../../context';
import { speechConfigured } from '../../lib/azure';
import { InlineNotice } from '../../ui/InlineNotice';
import { LinkButton } from '../../ui/LinkButton';

/** Shown under an Azure engine choice while Azure Speech is not set up yet; null once it is. */
export function AzureSpeechHint() {
  const controller = useController();
  const view = useView();
  if (speechConfigured(view)) return null;
  return (
    <InlineNotice
      tone="warning"
      action={<LinkButton onClick={() => controller.navigate('ai')}>Open AI settings</LinkButton>}
    >
      Azure Speech is not set up yet. Turn it on and add your region and key under AI. Until then
      Beekeeper keeps using the offline and system voices.
    </InlineNotice>
  );
}

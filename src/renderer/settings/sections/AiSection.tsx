import { InlineNotice } from '../ui/InlineNotice';
import { SectionPage } from '../ui/SectionPage';
import { AzureOpenAiCard } from './ai/AzureOpenAiCard';
import { AzureSpeechCard } from './ai/AzureSpeechCard';

export function AiSection() {
  return (
    <SectionPage section="ai">
      <InlineNotice icon="lock">
        Keys are stored encrypted on this PC (Windows DPAPI via Electron safeStorage) and never
        leave Beekeeper&apos;s main process. Everything works offline without them.
      </InlineNotice>
      <AzureSpeechCard />
      <AzureOpenAiCard />
    </SectionPage>
  );
}

import { Icon, type IconName } from '@renderer/components/Icon';
import { SettingsGroup } from '@renderer/components/forms';
import { modelManifest } from '@shared/models';
import { SPEECH_PACKS, type SpeechPackId } from '@shared/speech/packs';

interface NetworkUse {
  icon: IconName;
  title: string;
  text: string;
}

function hostsOf(urls: readonly string[]): string {
  const hosts = [...new Set(urls.map((url) => new URL(url).hostname))];
  const last = hosts.at(-1) ?? '';
  return hosts.length > 1 ? `${hosts.slice(0, -1).join(', ')} or ${last}` : last;
}

/** Download hosts of one speech pack, read from the catalogue so the list cannot drift from it. */
function packHosts(id: SpeechPackId): string {
  const { archive, files } = SPEECH_PACKS[id];
  return hostsOf(archive ? [archive.url] : (files ?? []).map((file) => file.url));
}

const NETWORK_USES: readonly NetworkUse[] = [
  {
    icon: 'cloud',
    title: 'Weather',
    text: 'Open-Meteo (api.open-meteo.com) answers weather questions. Only the place you ask about, or your approximate coordinates, is sent.',
  },
  {
    icon: 'globe',
    title: 'Automatic weather location',
    text: 'Your IP address goes to an IP lookup service (ipwho.is, geojs.io or ipapi.co) to find your nearest city. Pick a city under General to avoid it.',
  },
  {
    icon: 'book',
    title: 'Dictionary',
    text: 'dictionaryapi.dev looks up the word when you ask Beekeeper to define something.',
  },
  {
    icon: 'download',
    title: 'Voice model download',
    text: `Once, from ${hostsOf(modelManifest.urls)}. The file is checked against a SHA-256 checksum before it is used.`,
  },
  {
    icon: 'download',
    title: 'Natural voice download',
    text: `Only when you download the natural voice: once, from ${packHosts('supertonic-3')}. The files are checked against SHA-256 checksums before they are used.`,
  },
  {
    icon: 'download',
    title: 'Whisper speech models',
    text: `Only when you download Whisper: once, from ${packHosts('whisper-small')}. The files are checked against SHA-256 checksums before they are used. Recognition itself runs on this PC.`,
  },
  {
    icon: 'sparkle',
    title: 'Azure (optional)',
    text: 'Only if you add keys and turn it on: your voice goes to your Azure Speech resource, and questions (plus any screen selection you ask about) to your Azure OpenAI deployment.',
  },
  {
    icon: 'speaker',
    title: 'ElevenLabs (optional)',
    text: "Only if you add an ElevenLabs key and choose it as the assistant voice: the text of Beekeeper's replies is sent to api.elevenlabs.io to be turned into speech. Your voice and everything else stay on this PC.",
  },
  {
    icon: 'refresh',
    title: 'Update check',
    text: 'Beekeeper asks GitHub Releases whether a newer version exists. Turn off auto-update under Updates to stop background checks.',
  },
];

/** Everything that can touch the network, in plain words. Anything not listed stays on this PC. */
export function NetworkList() {
  return (
    <SettingsGroup
      title="What can use the internet"
      footer="Everything else, including speech recognition, reading text from the screen and your notes, happens on this PC."
    >
      <ul className="divide-y divide-line">
        {NETWORK_USES.map((use) => (
          <li key={use.title} className="flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken text-accent-text">
              <Icon name={use.icon} size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] leading-5 font-medium text-fg">{use.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-muted">{use.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </SettingsGroup>
  );
}

import { Icon, type IconName } from '@renderer/components/Icon';
import { SettingsGroup } from '@renderer/components/forms';
import { modelManifest } from '@shared/models';

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
    icon: 'sparkle',
    title: 'Azure (optional)',
    text: 'Only if you add keys and turn it on: your voice goes to your Azure Speech resource, and questions (plus any screen selection you ask about) to your Azure OpenAI deployment.',
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

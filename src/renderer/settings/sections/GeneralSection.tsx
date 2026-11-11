import { Button } from '@renderer/components/Button';
import {
  Segmented,
  SelectField,
  SettingRow,
  SettingsGroup,
  ToggleRow,
  type SegmentedOption,
} from '@renderer/components/forms';
import { useController, useSettingsStore, useSetter, useView } from '../context';
import { validateCity } from '../lib/validation';
import { TextField } from '../ui/fields';
import { SectionPage } from '../ui/SectionPage';

const THEMES: readonly SegmentedOption<'system' | 'light' | 'dark'>[] = [
  { value: 'system', label: 'System', icon: 'display' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

const UNITS: readonly SegmentedOption<'metric' | 'imperial'>[] = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial' },
];

const LOCATION_MODES: readonly SegmentedOption<'auto' | 'manual'>[] = [
  { value: 'auto', label: 'Auto (by IP)' },
  { value: 'manual', label: 'Manual' },
];

const LANGUAGES = [{ value: 'en-US', label: 'English (United States)' }];

export function GeneralSection() {
  const controller = useController();
  const { general } = useView();
  const portable = useSettingsStore((state) => state.info?.portable ?? false);
  const setGeneral = useSetter('general');
  const location = general.weatherLocation;

  return (
    <SectionPage section="general">
      <SettingsGroup title="Startup">
        <ToggleRow
          label="Start with Windows"
          description={
            portable
              ? 'The portable build cannot start with Windows. Use the installer for this.'
              : 'Open Beekeeper in the tray when you sign in to Windows.'
          }
          checked={general.startWithWindows}
          disabled={portable}
          onChange={(on) => setGeneral('startWithWindows', on)}
        />
        <SettingRow
          label="Welcome tour"
          description="Walk through the microphone, voice model and shortcuts setup again."
        >
          <Button
            size="sm"
            icon="play"
            onClick={() =>
              void controller.run('Could not open the welcome tour', (bridge) =>
                bridge.invoke('window:openOnboarding'),
              )
            }
          >
            Replay
          </Button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Appearance">
        <SettingRow label="Theme" description="Follow Windows, or always use light or dark.">
          <Segmented
            label="Theme"
            value={general.theme}
            options={THEMES}
            onChange={(theme) => setGeneral('theme', theme)}
          />
        </SettingRow>
        <SettingRow label="Language" description="Beekeeper understands English (US) for now.">
          <SelectField
            label="Language"
            value={general.language}
            options={LANGUAGES}
            onChange={() => undefined}
            readOnly
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Weather and units">
        <SettingRow
          label="Units"
          description="Metric shows °C and km/h, imperial shows °F and mph."
        >
          <Segmented
            label="Units"
            value={general.units}
            options={UNITS}
            onChange={(units) => setGeneral('units', units)}
          />
        </SettingRow>
        <SettingRow
          label="Weather location"
          description={
            location.mode === 'auto'
              ? 'Uses your approximate location (looked up from your IP address) when you ask.'
              : 'Always uses the city below unless you ask about another place.'
          }
        >
          <Segmented
            label="Weather location"
            value={location.mode}
            options={LOCATION_MODES}
            onChange={(mode) => setGeneral('weatherLocation', { ...location, mode })}
          />
        </SettingRow>
        {location.mode === 'manual' ? (
          <SettingRow
            label="City"
            description={
              location.city === ''
                ? 'Type a city to use. Until then your approximate location is used.'
                : 'For example Seattle, Berlin or Tokyo.'
            }
          >
            <TextField
              label="City"
              value={location.city}
              placeholder="City name"
              validate={validateCity}
              onCommit={(city) => setGeneral('weatherLocation', { ...location, city })}
            />
          </SettingRow>
        ) : null}
      </SettingsGroup>
    </SectionPage>
  );
}

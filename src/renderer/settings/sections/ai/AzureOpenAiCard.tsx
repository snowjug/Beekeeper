import { SettingRow, SettingsGroup, ToggleRow } from '@renderer/components/forms';
import { useSetter, useView } from '../../context';
import { openAiFieldsSet } from '../../lib/azure';
import { validateApiVersion, validateDeployment, validateEndpoint } from '../../lib/validation';
import { TextField } from '../../ui/fields';
import { InlineNotice } from '../../ui/InlineNotice';
import { ConnectionTest } from './ConnectionTest';
import { SecretField } from './SecretField';

export function AzureOpenAiCard() {
  const view = useView();
  const { ai, secrets } = view;
  const setAi = useSetter('ai');
  const configured = openAiFieldsSet(view);

  return (
    <SettingsGroup
      title="Azure OpenAI"
      footer="Optional. Answers anything the built-in commands cannot, and can describe what you circle."
    >
      <ToggleRow
        label="Use Azure OpenAI"
        description="Send questions that are not commands to your own Azure OpenAI deployment."
        checked={ai.useAzureOpenAi}
        onChange={(on) => setAi('useAzureOpenAi', on)}
        below={
          ai.useAzureOpenAi && !configured ? (
            <InlineNotice tone="warning">
              Add the endpoint, deployment name and key below before Azure OpenAI can be used.
            </InlineNotice>
          ) : undefined
        }
      />
      <SettingRow
        stacked
        label="Endpoint"
        description="The https address of your resource, for example https://my-resource.openai.azure.com."
      >
        <TextField
          fullWidth
          mono
          inputMode="url"
          label="Azure OpenAI endpoint"
          value={ai.openAiEndpoint}
          placeholder="https://my-resource.openai.azure.com"
          validate={validateEndpoint}
          onCommit={(endpoint) => setAi('openAiEndpoint', endpoint)}
        />
      </SettingRow>
      <SettingRow label="Deployment name" description="The name you gave the model deployment.">
        <TextField
          label="Azure OpenAI deployment name"
          value={ai.openAiDeployment}
          placeholder="gpt-4o"
          validate={validateDeployment}
          onCommit={(name) => setAi('openAiDeployment', name)}
        />
      </SettingRow>
      <SettingRow
        label="API version"
        description="Leave the default unless your resource needs another."
      >
        <TextField
          label="Azure OpenAI API version"
          value={ai.openAiApiVersion}
          placeholder="2024-10-21"
          validate={validateApiVersion}
          onCommit={(version) => setAi('openAiApiVersion', version)}
        />
      </SettingRow>
      <SettingRow
        stacked
        label="API key"
        description="Stored encrypted on this PC. It is never shown again."
      >
        <SecretField name="openai" label="Azure OpenAI API key" hint={secrets.openAiKey} />
      </SettingRow>
      <ConnectionTest
        service="openai"
        canTest={configured}
        missingHint="Add the endpoint, deployment name and a key to test the connection."
        signature={`${ai.openAiEndpoint}|${ai.openAiDeployment}|${ai.openAiApiVersion}|${secrets.openAiKey ?? ''}`}
      />
    </SettingsGroup>
  );
}

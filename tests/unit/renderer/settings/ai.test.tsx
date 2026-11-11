import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { AiSection } from '@renderer/settings/sections/AiSection';
import {
  clearToasts,
  makeView,
  renderWithController,
  startController,
  toastTitles,
  type Handlers,
} from './support';

afterEach(clearToasts);

const HINT = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221a2b';
const SECRET = 'sk-test-0123456789-VERY-SECRET';

async function mount(configure?: Parameters<typeof makeView>[0], handlers: Handlers = {}) {
  const h = await startController({ view: makeView(configure), handlers });
  const ui = renderWithController(<AiSection />, h.controller);
  return { h, ...ui };
}

function card(title: string): HTMLElement {
  return screen.getByRole('group', { name: title });
}

describe('AI section: keys', () => {
  it('shows only the masked hint of a stored key, never an input holding it', async () => {
    const { h, container } = await mount((view) => {
      view.secrets.speechKey = HINT;
    });
    const speech = card('Azure Speech');

    expect(within(speech).getByText(HINT)).toBeInTheDocument();
    expect(within(speech).getByText('A key is saved, ending in 1a2b')).toBeInTheDocument();
    expect(within(speech).queryByLabelText('Azure Speech API key')).toBeNull();
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
    expect(within(speech).getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(within(speech).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    h.stop();
  });

  it('replaces a key through a password field that is cleared and removed after saving', async () => {
    const user = userEvent.setup();
    const { h, container } = await mount(
      (view) => {
        view.secrets.speechKey = HINT;
      },
      {
        'ai:setKey': () =>
          makeView((view) => {
            view.secrets.speechKey = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022CRET';
          }),
      },
    );
    const speech = card('Azure Speech');
    await user.click(within(speech).getByRole('button', { name: 'Replace' }));

    const input = within(speech).getByLabelText('Azure Speech API key');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveValue('');
    await user.type(input, SECRET);
    expect(input).toHaveValue(SECRET);

    await user.click(within(speech).getByRole('button', { name: 'Save key' }));
    await waitFor(() =>
      expect(h.inputsOf('ai:setKey')).toEqual([{ name: 'speech', value: SECRET }]),
    );

    await waitFor(() => expect(within(speech).queryByLabelText('Azure Speech API key')).toBeNull());
    expect(
      within(speech).getByText('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022CRET'),
    ).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(JSON.stringify(h.controller.store.getState())).not.toContain(SECRET);
    expect(toastTitles()).toEqual(['Key saved']);
    h.stop();
  });

  it('refuses keys that are too short without calling the main process', async () => {
    const user = userEvent.setup();
    const { h } = await mount();
    const openai = card('Azure OpenAI');

    await user.type(within(openai).getByLabelText('Azure OpenAI API key'), 'short');
    await user.click(within(openai).getByRole('button', { name: 'Save key' }));

    expect(await within(openai).findByRole('alert')).toHaveTextContent(
      'That looks too short to be an API key.',
    );
    expect(h.inputsOf('ai:setKey')).toHaveLength(0);
    h.stop();
  });

  it('keeps what was typed (hidden) and shows the reason when saving fails', async () => {
    const user = userEvent.setup();
    const { h } = await mount(undefined, {
      'ai:setKey': () => {
        throw new Error(
          "Error invoking remote method 'ai:setKey': Error: Secure storage is not available on this system, so the key was not saved.",
        );
      },
    });
    const speech = card('Azure Speech');
    const input = within(speech).getByLabelText('Azure Speech API key');
    await user.type(input, SECRET);
    await user.click(within(speech).getByRole('button', { name: 'Save key' }));

    expect(await within(speech).findByRole('alert')).toHaveTextContent(
      'Secure storage is not available on this system, so the key was not saved.',
    );
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue(SECRET);
    h.stop();
  });

  it('removes a key after a second confirming press', async () => {
    const user = userEvent.setup();
    const { h } = await mount(
      (view) => {
        view.secrets.openAiKey = HINT;
      },
      { 'ai:clearKey': () => makeView() },
    );
    const openai = card('Azure OpenAI');

    await user.click(within(openai).getByRole('button', { name: 'Remove' }));
    expect(h.inputsOf('ai:clearKey')).toHaveLength(0);
    await user.click(within(openai).getByRole('button', { name: 'Yes, remove' }));

    await waitFor(() => expect(h.inputsOf('ai:clearKey')).toEqual([{ name: 'openai' }]));
    await waitFor(() =>
      expect(within(openai).getByLabelText('Azure OpenAI API key')).toBeInTheDocument(),
    );
    expect(toastTitles()).toEqual(['Key removed']);
    h.stop();
  });
});

describe('AI section: settings and connection tests', () => {
  it('toggles send one minimal patch', async () => {
    const user = userEvent.setup();
    const { h } = await mount();
    await user.click(screen.getByRole('switch', { name: 'Use Azure Speech' }));
    expect(h.inputsOf('settings:update')).toEqual([{ ai: { useAzureSpeech: true } }]);
    expect(await screen.findByText(/Add the region and key below/)).toBeInTheDocument();
    h.stop();
  });

  it('validates the endpoint inline and only sends a good https address', async () => {
    const user = userEvent.setup();
    const { h } = await mount();
    const endpoint = screen.getByRole('textbox', { name: 'Azure OpenAI endpoint' });

    await user.type(endpoint, 'http://my.openai.azure.com');
    await user.tab();
    expect(
      await screen.findByText('Use https:// - plain http is not allowed.'),
    ).toBeInTheDocument();
    expect(h.inputsOf('settings:update')).toHaveLength(0);

    await user.clear(endpoint);
    await user.type(endpoint, 'https://my.openai.azure.com');
    await user.tab();
    await waitFor(() =>
      expect(h.inputsOf('settings:update')).toEqual([
        { ai: { openAiEndpoint: 'https://my.openai.azure.com' } },
      ]),
    );
    expect(screen.queryByText('Use https:// - plain http is not allowed.')).toBeNull();
    h.stop();
  });

  it('keeps Test connection disabled until the needed fields exist', async () => {
    const { h } = await mount();
    const speech = card('Azure Speech');
    expect(within(speech).getByRole('button', { name: 'Test connection' })).toBeDisabled();
    expect(
      within(speech).getByText('Add a region and a key to test the connection.'),
    ).toBeInTheDocument();
    expect(
      within(card('Azure OpenAI')).getByRole('button', { name: 'Test connection' }),
    ).toBeDisabled();
    h.stop();
  });

  it('tests the saved settings and shows the result with its latency', async () => {
    const user = userEvent.setup();
    const { h } = await mount(
      (view) => {
        view.ai.speechRegion = 'westeurope';
        view.secrets.speechKey = HINT;
      },
      { 'ai:test': () => ({ ok: true, message: 'Azure Speech answered.', latencyMs: 182 }) },
    );
    const speech = card('Azure Speech');
    await user.click(within(speech).getByRole('button', { name: 'Test connection' }));

    expect(await within(speech).findByText('Connected')).toBeInTheDocument();
    expect(within(speech).getByText(/in 182 ms/)).toBeInTheDocument();
    expect(h.inputsOf('ai:test')).toEqual([{ service: 'speech' }]);
    h.stop();
  });

  it('shows a failed test, and a friendly state when the handler is unavailable', async () => {
    const user = userEvent.setup();
    let answer: 'invalid' | 'throw' = 'invalid';
    const { h } = await mount(
      (view) => {
        view.ai.useAzureOpenAi = true;
        view.ai.openAiEndpoint = 'https://my.openai.azure.com';
        view.ai.openAiDeployment = 'gpt-4o';
        view.secrets.openAiKey = HINT;
      },
      {
        'ai:test': () => {
          if (answer === 'throw') throw new Error('No handler registered for ai:test');
          return { ok: false, message: 'The key was rejected (401).' };
        },
      },
    );
    const openai = card('Azure OpenAI');
    await user.click(within(openai).getByRole('button', { name: 'Test connection' }));
    expect(await within(openai).findByText('Connection failed')).toBeInTheDocument();
    expect(within(openai).getByText(/The key was rejected \(401\)/)).toBeInTheDocument();

    answer = 'throw';
    await user.click(within(openai).getByRole('button', { name: 'Test connection' }));
    expect(await within(openai).findByText(/Could not run the test/)).toBeInTheDocument();
    h.stop();
  });
});

import { expect, openAssistant, test } from './fixtures';

test.describe('assistant bar', () => {
  test('opens, answers "what time is it" and "calculate 15% of 2400"', async ({ launched }) => {
    const page = await openAssistant(launched.app);
    const input = page.getByRole('textbox', { name: 'Ask Beekeeper' });
    await expect(input).toBeFocused();

    await input.fill('what time is it');
    await input.press('Enter');
    await expect(page.locator('[data-card-kind="time"]')).toBeVisible();

    await input.fill('calculate 15% of 2400');
    await input.press('Enter');
    const calc = page.locator('[data-card-kind="calc"]');
    await expect(calc).toBeVisible();
    await expect(calc).toContainText('360');
  });
});

import { test, expect } from '@playwright/test';
import {
  Theme,
  Viewport,
  VisualTestConfig,
  setViewport,
  setTheme,
  takeScreenshot,
  getScreenshotPath,
} from './utils';

const themes: Theme[] = ['light', 'dark'];
const viewports: Viewport[] = ['desktop', 'mobile'];

test.describe('Login Page Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
  });

  for (const theme of themes) {
    for (const viewport of viewports) {
      test(`Login - ${theme} theme - ${viewport}`, async ({ page }) => {
        const config: VisualTestConfig = {
          theme,
          viewport,
          pageName: 'login',
        };

        await setViewport(page, viewport);
        await setTheme(page, theme);

        const screenshot = await takeScreenshot(page, config);
        const screenshotPath = getScreenshotPath(config);

        expect(screenshot).toBeDefined();
        expect(screenshot.length).toBeGreaterThan(0);

        await test.info().attach(screenshotPath, {
          body: screenshot,
          contentType: 'image/png',
        });
      });
    }
  }
});

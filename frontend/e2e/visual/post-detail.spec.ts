import { test, expect } from '@playwright/test';
import {
  Theme,
  Viewport,
  VisualTestConfig,
  setViewport,
  setTheme,
  login,
  takeScreenshot,
  getScreenshotPath,
} from './utils';

const themes: Theme[] = ['light', 'dark'];
const viewports: Viewport[] = ['desktop', 'mobile'];

test.describe('Post Detail Page Visual Regression', () => {
  for (const theme of themes) {
    for (const viewport of viewports) {
      test(`PostDetail - ${theme} theme - ${viewport}`, async ({ page }) => {
        const config: VisualTestConfig = {
          theme,
          viewport,
          pageName: 'post-detail',
        };

        await setViewport(page, viewport);
        await login(page);
        await setTheme(page, theme);

        await page.goto('/post/slug/getting-started');
        await page.waitForLoadState('networkidle');

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

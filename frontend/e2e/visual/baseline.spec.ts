import { test, expect } from '@playwright/test';
import {
  Theme,
  Viewport,
  VisualTestConfig,
  setViewport,
  setTheme,
  takeScreenshot,
  getScreenshotPath,
  login,
} from './utils';

const themes: Theme[] = ['light', 'dark'];
const viewports: Viewport[] = ['desktop', 'mobile'];

const pages = [
  { name: 'login', path: '/login', requiresAuth: false },
  { name: 'home', path: '/', requiresAuth: true },
  { name: 'post-detail', path: '/post/getting-started', requiresAuth: true },
];

test.describe('Baseline Screenshot Capture', () => {
  for (const page of pages) {
    for (const theme of themes) {
      for (const viewport of viewports) {
        test(`${page.name} - ${theme} - ${viewport}`, async ({ page: testPage }) => {
          const config: VisualTestConfig = {
            theme,
            viewport,
            pageName: page.name,
          };

          await setViewport(testPage, viewport);

          if (page.requiresAuth) {
            await login(testPage);
          }

          await testPage.goto(page.path);
          await testPage.waitForLoadState('networkidle');
          await setTheme(testPage, theme);

          const screenshot = await takeScreenshot(testPage, config);
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
  }
});

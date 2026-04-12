import { Page, expect } from '@playwright/test';

/**
 * Visual regression testing utilities for DouBlog
 */

export type Theme = 'light' | 'dark';
export type Viewport = 'desktop' | 'mobile';

export interface VisualTestConfig {
  theme: Theme;
  viewport: Viewport;
  pageName: string;
}

/**
 * Viewport dimensions
 */
export const VIEWPORTS = {
  desktop: { width: 1920, height: 1080 },
  mobile: { width: 375, height: 812 },
} as const;

/**
 * Set theme by toggling the theme switcher
 */
export async function setTheme(page: Page, theme: Theme): Promise<void> {
  // Set theme directly via localStorage and html class
  await page.evaluate((targetTheme) => {
    localStorage.setItem('theme', targetTheme);
    const html = document.documentElement;
    if (targetTheme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }, theme);

  // Wait for theme to apply
  await page.waitForTimeout(300);

  // Verify theme is set
  const htmlElement = page.locator('html');
  const isDark = await htmlElement.evaluate((el) => el.classList.contains('dark'));
  expect(isDark).toBe(theme === 'dark');
}

/**
 * Set viewport size
 */
export async function setViewport(page: Page, viewport: Viewport): Promise<void> {
  const { width, height } = VIEWPORTS[viewport];
  await page.setViewportSize({ width, height });
}

/**
 * Login to the application
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  // Fill login form
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'lizy111A');
  await page.click('button[type="submit"]');

  // Wait for redirect to home
  await page.waitForURL('/', { timeout: 10000 });
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for all images to load
 */
export async function waitForImages(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const images = Array.from(document.images);
        return images.every((img) => img.complete && img.naturalHeight !== 0);
      },
      { timeout: 5000 }
    );
  } catch {
    // Timeout is acceptable — some images may fail to load in test env
  }
}

/**
 * Hide dynamic elements that may cause flaky screenshots
 */
export async function hideDynamicElements(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      /* Hide timestamps, dates, and dynamic content */
      [data-testid="timestamp"],
      [data-testid="date"],
      .timestamp,
      .date {
        visibility: hidden !important;
      }
      
      /* Disable animations for stable screenshots */
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
      
      /* Hide scrollbars for cleaner screenshots */
      ::-webkit-scrollbar {
        display: none !important;
      }
    `,
  });
}

/**
 * Generate screenshot path
 */
export function getScreenshotPath(config: VisualTestConfig, pageName?: string): string {
  const name = pageName || config.pageName;
  return `visual/${config.viewport}/${config.theme}/${name}.png`;
}

/**
 * Take full page screenshot with proper setup
 */
export async function takeScreenshot(
  page: Page,
  config: VisualTestConfig,
  options?: { fullPage?: boolean; selector?: string }
): Promise<Buffer> {
  const { fullPage = true, selector } = options || {};

  // Wait for page to be fully loaded
  await page.waitForLoadState('networkidle');
  await waitForImages(page);
  await hideDynamicElements(page);

  // Small delay to ensure all styles are applied
  await page.waitForTimeout(300);

  if (selector) {
    const element = page.locator(selector);
    return element.screenshot();
  }

  return page.screenshot({ fullPage });
}

/**
 * Setup page for visual testing
 */
export async function setupPageForVisualTest(
  page: Page,
  config: VisualTestConfig
): Promise<void> {
  // Set viewport
  await setViewport(page, config.viewport);

  // Login if needed (for protected pages)
  const currentUrl = page.url();
  if (!currentUrl.includes('/login') && !currentUrl.includes('/auth')) {
    await login(page);
  }

  // Set theme
  await setTheme(page, config.theme);
}

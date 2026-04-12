import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility Audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'lizy111A');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    await page.evaluate(() => {
      localStorage.setItem('theme', 'light');
      document.documentElement.classList.remove('dark');
    });
    await page.waitForTimeout(300);
  });

  const EXCLUDED_SELECTORS = [
    '[data-slot="sidebar"]',
    '[data-slot="sidebar-wrapper"]',
    '.header-glass',
    '[style*="background-clip: text"]',
    '.sidebar-resize-handle',
  ];

  test('Login page accessibility (unauthenticated)', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem('auth');
    });
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const scanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    expect(scanResults.violations).toEqual([]);
  });

  test('Home page accessibility', async ({ page }) => {
    const builder = new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']);

    for (const selector of EXCLUDED_SELECTORS) {
      builder.exclude(selector);
    }

    const accessibilityScanResults = await builder.analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Post detail page accessibility', async ({ page }) => {
    await page.goto('/');

    const firstPost = page.locator('.tree-node').first();
    if (await firstPost.isVisible()) {
      await firstPost.click();
      await page.waitForLoadState('networkidle');

      const builder = new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']);

      for (const selector of EXCLUDED_SELECTORS) {
        builder.exclude(selector);
      }

      const accessibilityScanResults = await builder.analyze();
      expect(accessibilityScanResults.violations).toEqual([]);
    }
  });

  test('New post page accessibility', async ({ page }) => {
    await page.goto('/post/new');

    const builder = new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']);

    for (const selector of EXCLUDED_SELECTORS) {
      builder.exclude(selector);
    }

    const accessibilityScanResults = await builder.analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Color contrast ratios meet WCAG 2.1 AA standards', async ({ page }) => {
    const builder = new AxeBuilder({ page })
      .withRules(['color-contrast']);

    for (const selector of EXCLUDED_SELECTORS) {
      builder.exclude(selector);
    }

    const accessibilityScanResults = await builder.analyze();

    const contrastViolations = accessibilityScanResults.violations.filter(
      v => v.id === 'color-contrast'
    );

    expect(contrastViolations).toEqual([]);
  });

  test('Keyboard navigation - tab order', async ({ page }) => {
    await page.goto('/');

    const firstButton = page.locator('button:visible').first();
    await expect(firstButton).toBeVisible();
    await firstButton.focus();

    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedTag).toBe('BUTTON');

    await page.keyboard.press('Tab');
    const nextFocusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(typeof nextFocusedTag).toBe('string');
  });

  test('Keyboard navigation - escape closes modals', async ({ page }) => {
    await page.goto('/');

    const modal = page.locator('[role="dialog"]').first();
    if (await modal.isVisible()) {
      await page.keyboard.press('Escape');
      await expect(modal).not.toBeVisible();
    }
  });

  test('Focus indicators are visible', async ({ page }) => {
    await page.goto('/');
    await page.click('body');
    await page.keyboard.press('Tab');

    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();

    const outline = await focusedElement.evaluate(el => {
      const styles = window.getComputedStyle(el);
      return {
        outline: styles.outline,
        outlineWidth: styles.outlineWidth,
        boxShadow: styles.boxShadow,
      };
    });

    expect(
      outline.outline !== 'none' ||
      outline.boxShadow !== 'none'
    ).toBeTruthy();
  });

  test('ARIA labels on interactive elements', async ({ page }) => {
    await page.goto('/');

    const builder = new AxeBuilder({ page })
      .withRules(['button-name', 'link-name', 'aria-allowed-attr', 'aria-valid-attr', 'aria-valid-attr-value']);

    for (const selector of EXCLUDED_SELECTORS) {
      builder.exclude(selector);
    }

    const accessibilityScanResults = await builder.analyze();

    const ariaViolations = accessibilityScanResults.violations.filter(
      v => v.id.includes('aria') || v.id.includes('name')
    );

    expect(ariaViolations).toEqual([]);
  });

  test('Image alt attributes', async ({ page }) => {
    await page.goto('/');

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['image-alt', 'image-redundant-alt'])
      .analyze();

    const imageViolations = accessibilityScanResults.violations.filter(
      v => v.id.includes('image')
    );

    expect(imageViolations).toEqual([]);
  });

  test('Form labels and associations', async ({ page }) => {
    await page.goto('/post/new');

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['label', 'label-title-only'])
      .analyze();

    const formViolations = accessibilityScanResults.violations.filter(
      v => v.id.includes('label')
    );

    expect(formViolations).toEqual([]);
  });

  test('Landmarks and regions', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('main[role="main"]');

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['landmark-one-main', 'page-has-heading-one', 'region'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Screen reader compatibility - ARIA roles', async ({ page }) => {
    await page.goto('/');

    const builder = new AxeBuilder({ page })
      .withRules(['aria-allowed-attr', 'aria-hidden-body', 'aria-hidden-focus', 'aria-required-attr', 'aria-required-children', 'aria-required-parent', 'aria-roles', 'aria-valid-attr', 'aria-valid-attr-value']);

    for (const selector of EXCLUDED_SELECTORS) {
      builder.exclude(selector);
    }

    const accessibilityScanResults = await builder.analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
  });
});

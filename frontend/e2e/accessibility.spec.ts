import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility Audit', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to login and authenticate
    await page.goto('/login');
    
    // Fill login form
    await page.fill('input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'lizy111A');
    await page.click('button[type="submit"]');
    
    // Wait for navigation to complete
    await page.waitForURL('/');
  });

  test('Login page accessibility', async ({ page }) => {
    await page.goto('/login');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Home page accessibility', async ({ page }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Post detail page accessibility', async ({ page }) => {
    // Navigate to a post (assuming there's at least one)
    await page.goto('/');
    
    // Click on first post in the tree if available
    const firstPost = page.locator('[role="treeitem"]').first();
    if (await firstPost.isVisible()) {
      await firstPost.click();
      await page.waitForLoadState('networkidle');
      
      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      
      expect(accessibilityScanResults.violations).toEqual([]);
    }
  });

  test('New post page accessibility', async ({ page }) => {
    await page.goto('/post/new');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Color contrast ratios meet WCAG 2.1 AA standards', async ({ page }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();
    
    const contrastViolations = accessibilityScanResults.violations.filter(
      v => v.id === 'color-contrast'
    );
    
    expect(contrastViolations).toEqual([]);
  });

  test('Keyboard navigation - tab order', async ({ page }) => {
    await page.goto('/');
    
    // Test tab navigation through interactive elements
    const focusableElements = await page.locator(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    ).all();
    
    for (const element of focusableElements.slice(0, 10)) {
      await page.keyboard.press('Tab');
      const focused = page.locator(':focus');
      await expect(focused).toBeVisible();
    }
  });

  test('Keyboard navigation - escape closes modals', async ({ page }) => {
    // Test if modals can be closed with Escape key
    // This would be expanded based on actual modal usage in the app
    await page.goto('/');
    
    // Check if any modals exist and test escape key
    const modal = page.locator('[role="dialog"]').first();
    if (await modal.isVisible()) {
      await page.keyboard.press('Escape');
      await expect(modal).not.toBeVisible();
    }
  });

  test('Focus indicators are visible', async ({ page }) => {
    await page.goto('/');
    
    // Tab to first focusable element
    await page.keyboard.press('Tab');
    
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();
    
    // Check that focus indicator has sufficient visibility
    // This is a visual check that would need manual verification
    const outline = await focusedElement.evaluate(el => {
      const styles = window.getComputedStyle(el);
      return {
        outline: styles.outline,
        outlineWidth: styles.outlineWidth,
        boxShadow: styles.boxShadow,
      };
    });
    
    // Focus should have some visual indicator
    expect(
      outline.outline !== 'none' || 
      outline.boxShadow !== 'none'
    ).toBeTruthy();
  });

  test('ARIA labels on interactive elements', async ({ page }) => {
    await page.goto('/');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['aria-label', 'aria-labelledby', 'button-name', 'link-name'])
      .analyze();
    
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
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['landmark-one-main', 'page-has-heading-one', 'region'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Screen reader compatibility - ARIA roles', async ({ page }) => {
    await page.goto('/');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['aria-allowed-attr', 'aria-hidden-body', 'aria-hidden-focus', 'aria-required-attr', 'aria-required-children', 'aria-required-parent', 'aria-roles', 'aria-valid-attr', 'aria-valid-attr-value'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });
});

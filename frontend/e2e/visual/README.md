# Visual Regression Testing

## Overview

Visual regression tests for DouBlog using Playwright to capture and compare screenshots across different themes and viewports.

## Test Structure

```
frontend/e2e/visual/
├── utils.ts              # Test utilities and helpers
├── login.spec.ts         # Login page visual tests
├── home.spec.ts          # Home page visual tests
├── post-detail.spec.ts   # Post detail page visual tests
└── baseline.spec.ts      # Comprehensive baseline capture
```

## Test Coverage

### Pages
- **Login Page** (`/login`)
- **Home Page** (`/`)
- **Post Detail Page** (`/post/getting-started`)

### Themes
- **Light theme**
- **Dark theme**

### Viewports
- **Desktop** (1920x1080)
- **Mobile** (375x812)

### Total Tests
- 3 pages × 2 themes × 2 viewports = **12 test cases**

## Running Tests

### Run all visual tests
```bash
npm run test:e2e -- e2e/visual/
```

### Run specific test suite
```bash
# Login page
npm run test:e2e -- e2e/visual/login.spec.ts

# Home page
npm run test:e2e -- e2e/visual/home.spec.ts

# Post detail page
npm run test:e2e -- e2e/visual/post-detail.spec.ts

# Baseline capture
npm run test:e2e -- e2e/visual/baseline.spec.ts
```

### Run with UI mode
```bash
npm run test:e2e:ui -- e2e/visual/
```

### View test report
```bash
npm run test:e2e:report
```

## Screenshot Storage

Screenshots are automatically attached to test results and stored in:
```
frontend/test-results/
```

Each screenshot follows the naming pattern:
```
visual/{viewport}/{theme}/{page-name}.png
```

Examples:
- `visual/desktop/light/login.png`
- `visual/mobile/dark/home.png`
- `visual/desktop/dark/post-detail.png`

## Utilities

### `setTheme(page, theme)`
Sets the application theme by manipulating localStorage and HTML class.

### `setViewport(page, viewport)`
Sets viewport dimensions (desktop: 1920x1080, mobile: 375x812).

### `login(page)`
Performs login with default credentials (admin/lizy111A).

### `takeScreenshot(page, config)`
Captures full-page screenshot with dynamic element hiding and image loading.

### `hideDynamicElements(page)`
Hides timestamps and disables animations for stable screenshots.

## Configuration

Visual tests use the main Playwright configuration (`playwright.config.ts`):
- **Browser**: Chromium
- **Base URL**: http://localhost:60101
- **Screenshots**: Enabled on failure
- **Video**: Retained on failure
- **Trace**: On first retry

## Best Practices

1. **Stable Screenshots**
   - Wait for network idle
   - Wait for images to load
   - Hide dynamic elements (timestamps)
   - Disable animations

2. **Theme Testing**
   - Test both light and dark themes
   - Verify CSS variable application
   - Check contrast and readability

3. **Viewport Testing**
   - Test responsive layouts
   - Verify mobile navigation
   - Check content overflow

4. **Baseline Management**
   - Capture baselines after verified UI changes
   - Store baselines in version control
   - Review diffs carefully before approving

## Integration

Visual tests are part of the E2E test suite and run alongside functional tests:

```bash
# Run all E2E tests (including visual)
npm run test:e2e

# Run only visual tests
npm run test:e2e -- e2e/visual/
```

## Test Results

Latest test run: **24 tests passed**

- Login Page: 4 tests ✓
- Home Page: 4 tests ✓
- Post Detail Page: 4 tests ✓
- Baseline Capture: 12 tests ✓

All screenshots captured successfully for:
- Light theme (desktop & mobile)
- Dark theme (desktop & mobile)

## Troubleshooting

### Screenshot flakiness
1. Increase wait times in `takeScreenshot()`
2. Add more specific selectors to `hideDynamicElements()`
3. Use `page.waitForSelector()` for critical elements

### Theme not applying
1. Check localStorage theme value
2. Verify HTML class toggle
3. Inspect CSS variable application

### Viewport issues
1. Verify viewport dimensions in `VIEWPORTS` constant
2. Check responsive breakpoints in CSS
3. Test with different device sizes

## Future Enhancements

- [ ] Add snapshot comparison with pixelmatch
- [ ] Implement visual diff reporting
- [ ] Add more pages (PostNew, PostEdit)
- [ ] Test more viewport sizes (tablet)
- [ ] Implement automatic baseline updates
- [ ] Add accessibility snapshots
- [ ] Test animations and transitions

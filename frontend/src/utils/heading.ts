/**
 * Generate a heading ID from text
 * Used by both MarkdownRenderer and PostDetail for TOC navigation
 */
export const generateHeadingId = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fa5-]/g, '')  // Keep Chinese characters \u4e00-\u9fa5
    .replace(/\s+/g, '-')
}

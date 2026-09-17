import { describe, expect, it } from 'vitest';
import { renderMarkdown, safeUrl } from './markdown';

describe('renderMarkdown', () => {
  it('escapes raw HTML', () => {
    const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('blocks unsafe link and image URLs', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href="javascript');
    expect(renderMarkdown('![x](data:text/html,hi)')).not.toContain('<img');
    expect(safeUrl('//evil.com')).toBeNull();
    expect(safeUrl('https://a.com')).toBe('https://a.com');
    expect(safeUrl('/screenshots/a.png')).toBe('/screenshots/a.png');
  });

  it('does not break out of attributes', () => {
    const html = renderMarkdown('[x](/a"onmouseover="alert(1))');
    expect(html).not.toContain('" onmouseover');
    expect(html).not.toMatch(/"onmouseover="/);
  });

  it('renders headings, emphasis, code and lists', () => {
    const html = renderMarkdown('## Plan\n**bold** and *it* and `a*b*c`\n\n- one\n  - nested\n- [x] done\n1. first');
    expect(html).toMatch(/<h2[^>]*>Plan<\/h2>/);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toMatch(/<code[^>]*>a\*b\*c<\/code>/);
    expect(html).toMatch(/<ul[^>]*><li>one<ul[^>]*><li>nested<\/li><\/ul><\/li>/);
    expect(html).toMatch(/<input type="checkbox" disabled checked/);
    expect(html).toMatch(/<ol[^>]*><li>first<\/li><\/ol>/);
  });

  it('links trade ids and journal days, not headings or entities', () => {
    const html = renderMarkdown("Took #42 on @2026-09-15, didn't wait");
    expect(html).toContain('href="/trades/42"');
    expect(html).toContain('href="/journal?day=2026-09-15"');
    expect(html).toContain('didn&#39;t');
    expect(renderMarkdown('# 42')).toMatch(/<h1[^>]*>42<\/h1>/);
  });

  it('renders images, links with code, quotes, tables, fences', () => {
    const html = renderMarkdown(
      '![chart](/screenshots/a.png)\n\n[see `x`](https://a.com)\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\n<b>raw</b>\n```'
    );
    expect(html).toMatch(/<img src="\/screenshots\/a.png"/);
    expect(html).toMatch(/<a href="https:\/\/a.com"[^>]*>see <code[^>]*>x<\/code><\/a>/);
    expect(html).toMatch(/<blockquote[^>]*><p[^>]*>quote<\/p><\/blockquote>/);
    expect(html).toMatch(/<th[^>]*>a<\/th>/);
    expect(html).toMatch(/<td[^>]*>2<\/td>/);
    expect(html).toContain('&lt;b&gt;raw&lt;/b&gt;');
  });
});

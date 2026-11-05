import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Markdown } from './Markdown.tsx';

it('renders Markdown with highlighted code and never runs raw HTML', () => {
  const html = renderToStaticMarkup(<Markdown text={'**굵게** `x`\n\n```js\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<img src=x onerror=alert(1)>'} />);
  expect(html).toContain('<strong>굵게</strong>');
  expect(html).toContain('<span class="hljs-keyword">const</span>');
  expect(html).toContain('<span>js</span>'); // language label above the block
  expect(html).toContain('<table>');
  expect(html).not.toContain('<img');
});

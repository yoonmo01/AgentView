import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CodeView } from './CodeView.tsx';

it('highlights code by extension with line numbers, and reads Markdown files as a document', () => {
  const py = renderToStaticMarkup(<CodeView path="a/b.py" text={'def f():\n    return "<b>"\n'} download="#" />);
  expect(py).toContain('<span class="hljs-keyword">def</span>');
  expect(py).toContain('Python · 2줄');
  expect(py).toContain('>1\n2</pre>'); // gutter
  expect(py).not.toContain('<b>'); // file text stays escaped
  const md = renderToStaticMarkup(<CodeView path="README.md" text={'# 제목\n\n- 하나'} download="#" />);
  expect(md).toContain('<h1>제목</h1>');
});

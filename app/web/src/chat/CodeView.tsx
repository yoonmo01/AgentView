import hljs from 'highlight.js/lib/common';
import { useMemo, useState } from 'react';
import { CopyButton, Markdown } from './Markdown.tsx';

const MAX_HIGHLIGHT = 200_000; // bigger files show plain, highlighting them would freeze the tab

/** A file's text, highlighted by its extension (guessed when unknown), with line numbers; Markdown files read as a document. */
export function CodeView({ path, text, download }: { path: string; text: string; download: string }) {
  const ext = /\.([\w+-]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';
  const isMd = ext === 'md' || ext === 'markdown';
  const [raw, setRaw] = useState(false);
  const code = useMemo(() => {
    if (text.length > MAX_HIGHLIGHT) return { html: null, lang: '' };
    const r = hljs.getLanguage(ext) ? hljs.highlight(text, { language: ext }) : hljs.highlightAuto(text);
    return { html: r.value, lang: hljs.getLanguage(r.language ?? '')?.name ?? '' }; // hljs escapes the text, so its HTML is safe
  }, [text, ext]);
  const lines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
  return (
    <div className="code-view">
      <div className="code-head">
        <span className="name" title={path}>{path}</span>
        <span>{isMd && !raw ? 'Markdown' : code.lang || '텍스트'} · {lines}줄</span>
        {isMd && <button type="button" className="copy" onClick={() => setRaw(!raw)}>{raw ? '문서로 보기' : '원문 보기'}</button>}
        <CopyButton text={() => text} />
        <a className="copy" href={download} download>다운로드</a>
      </div>
      {isMd && !raw ? <Markdown text={text} className="doc" /> : (
        <div className="code-body">
          <pre className="gutter" aria-hidden>{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
          {code.html === null ? <pre><code>{text}</code></pre> : <pre><code className="hljs" dangerouslySetInnerHTML={{ __html: code.html }} /></pre>}
        </div>
      )}
    </div>
  );
}

import { isValidElement, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/github-dark.css';

/** Copies `text()` and says so for a moment. */
export function CopyButton({ text }: { text: () => string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="copy" onClick={() => void navigator.clipboard.writeText(text()).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}>
      {done ? '복사됨' : '복사'}
    </button>
  );
}

/** A fenced code block: its language and a copy button above the highlighted code. */
function Pre({ children, node: _node, ...rest }: ComponentProps<'pre'> & { node?: unknown }) {
  const ref = useRef<HTMLPreElement>(null);
  const cls = isValidElement<{ className?: string }>(children) ? children.props.className ?? '' : '';
  const lang = /language-([\w+-]+)/.exec(cls)?.[1];
  return (
    <div className="code-block">
      <div className="code-head"><span>{lang ?? '코드'}</span><CopyButton text={() => ref.current?.innerText ?? ''} /></div>
      <pre ref={ref} {...rest}>{children}</pre>
    </div>
  );
}

/**
 * Model answers as Markdown (GitHub flavor: tables, task lists, strikethrough), code highlighted.
 * Raw HTML in the text is shown as text, never run (react-markdown's default).
 */
export function Markdown({ text, className = '' }: { text: string; className?: string }): ReactNode {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true }]]}
        components={{ pre: Pre, a: ({ node: _node, ...p }) => <a {...p} target="_blank" rel="noreferrer" /> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

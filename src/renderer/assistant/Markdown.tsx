import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useController } from './context';

const REMARK_PLUGINS = [remarkGfm];

/**
 * Markdown for answer cards. Raw HTML is never rendered (react-markdown escapes it), images are
 * dropped (the CSP forbids remote images anyway) and links open in the default browser through the
 * main process after validation - navigation inside the window is blocked.
 */
export function Markdown({ text }: { text: string }) {
  const controller = useController();

  const components: Components = {
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-accent-text underline decoration-accent-text/40 underline-offset-2 hover:decoration-accent-text"
        onClick={(event) => {
          event.preventDefault();
          if (href) void controller.openUrl(href);
        }}
      >
        {children}
      </a>
    ),
    img: () => null,
    p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
    h1: ({ children }) => <h3 className="mt-3 mb-1.5 text-base font-semibold">{children}</h3>,
    h2: ({ children }) => <h3 className="mt-3 mb-1.5 text-base font-semibold">{children}</h3>,
    h3: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold">{children}</h4>,
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-accent/60 pl-3 text-fg-muted">
        {children}
      </blockquote>
    ),
    code: ({ children, className }) => (
      <code
        className={`rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[0.85em] ${className ?? ''}`}
      >
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="my-2 overflow-x-auto rounded-control bg-sunken p-3 font-mono text-[13px] leading-relaxed">
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b border-line px-2 py-1 text-left font-semibold">{children}</th>
    ),
    td: ({ children }) => <td className="border-b border-line/60 px-2 py-1">{children}</td>,
  };

  return (
    <div className="text-[15px] leading-relaxed" data-selectable="true">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

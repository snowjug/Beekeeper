import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useController } from './context';

const REMARK_PLUGINS = [remarkGfm];

/** Markdown for AI answers: no raw HTML, no images, links open in the default browser via main. */
export function AnswerMarkdown({ text }: { text: string }) {
  const controller = useController();
  return (
    <div
      className="text-[15px] leading-relaxed"
      data-selectable="true"
      data-testid="circle-ai-answer"
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-accent-text underline underline-offset-2"
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
          code: ({ children }) => (
            <code className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[0.85em]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-control bg-sunken p-3 font-mono text-[13px]">
              {children}
            </pre>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

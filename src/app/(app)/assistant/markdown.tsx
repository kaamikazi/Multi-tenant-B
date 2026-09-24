import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders the assistant's Markdown. react-markdown never renders raw HTML,
// so model output can't inject markup or scripts into the page.
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: (props) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
        ul: (props) => <ul className="my-2 list-disc space-y-1 pl-5" {...props} />,
        ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />,
        strong: (props) => <strong className="font-semibold" {...props} />,
        a: (props) => <a className="text-accent underline" target="_blank" rel="noreferrer" {...props} />,
        code: (props) => <code className="rounded bg-background px-1 py-0.5 font-mono text-[0.9em]" {...props} />,
        table: (props) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm" {...props} />
          </div>
        ),
        th: (props) => <th className="border-b border-line px-2 py-1.5 font-medium" {...props} />,
        td: (props) => <td className="border-b border-line px-2 py-1.5" {...props} />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

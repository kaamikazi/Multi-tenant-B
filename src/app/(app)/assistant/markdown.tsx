import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { policyComponents } from "./markdown-policy";

// Renders the assistant's Markdown. Model output is untrusted, so raw HTML is
// skipped, images never render and only same-app links stay clickable (see
// markdown-policy.ts). The Content-Security-Policy is the second layer:
// img-src and connect-src only allow this origin.
const components: Components = {
  p: (props) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  ul: (props) => <ul className="my-2 list-disc space-y-1 pl-5" {...props} />,
  ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />,
  strong: (props) => <strong className="font-semibold" {...props} />,
  code: (props) => <code className="rounded bg-background px-1 py-0.5 font-mono text-[0.9em]" {...props} />,
  table: (props) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm" {...props} />
    </div>
  ),
  th: (props) => <th className="border-b border-line px-2 py-1.5 font-medium" {...props} />,
  td: (props) => <td className="border-b border-line px-2 py-1.5" {...props} />,
  ...policyComponents,
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
      {children}
    </ReactMarkdown>
  );
}

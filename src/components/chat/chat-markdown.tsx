import * as React from "react";

import { cn } from "@/lib/utils";

export interface ChatMarkdownProps {
  text: string;
  /** Enlaces internos (`/ayuda/...`): la app decide cómo navegar. Sin esto abren como enlaces normales. */
  onNavigate?: (href: string) => void;
  className?: string;
}

function isInternal(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

/** Solo se enlaza lo que es una ruta interna o una dirección http(s): nada de `javascript:`. */
function isSafeHref(href: string): boolean {
  return isInternal(href) || /^https?:\/\//i.test(href);
}

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

function renderInline(text: string, onNavigate: ChatMarkdownProps["onNavigate"], keyPrefix: string): React.ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      if (!isSafeHref(href)) return <React.Fragment key={key}>{label}</React.Fragment>;
      if (isInternal(href) && onNavigate) {
        return (
          <a
            key={key}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(href);
            }}
          >
            {label}
          </a>
        );
      }
      return (
        <a key={key} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.split("\n")) {
    const last = blocks.at(-1);
    if (line.trim() === "") {
      // Una línea en blanco cierra el bloque: el siguiente texto empieza párrafo.
      if (last && !(last.kind === "paragraph" && last.lines.length === 0)) {
        blocks.push({ kind: "paragraph", lines: [] });
      }
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", text: heading[1] });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const item = (bullet ?? numbered)![1];
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
      continue;
    }
    if (last?.kind === "paragraph") last.lines.push(line);
    else blocks.push({ kind: "paragraph", lines: [line] });
  }
  return blocks.filter((block) => block.kind !== "paragraph" || block.lines.length > 0);
}

/**
 * El Markdown ligero de una respuesta (Thema · `ChatMarkdown`): negritas,
 * listas, enlaces y código. Sin títulos ni tablas: una respuesta es un
 * mensaje, no un documento; si el texto trae un título, se lee como negrita.
 *
 * Thema lo monta con `react-markdown`; SellUp no lo tiene, así que el texto se
 * parte aquí y se pinta como elementos de React. Nunca se inyecta HTML.
 */
export function ChatMarkdown({ text, onNavigate, className }: ChatMarkdownProps) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={cn("chat-prose break-words text-sm leading-relaxed text-muted-foreground", className)}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <p key={index} className="font-semibold text-foreground">
              {renderInline(block.text, onNavigate, `h${index}`)}
            </p>
          );
        }
        if (block.kind === "list") {
          const items = block.items.map((item, position) => (
            <li key={position}>{renderInline(item, onNavigate, `l${index}-${position}`)}</li>
          ));
          return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
        }
        return (
          <p key={index}>
            {block.lines.map((line, position) => (
              <React.Fragment key={position}>
                {position > 0 && <br />}
                {renderInline(line, onNavigate, `p${index}-${position}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

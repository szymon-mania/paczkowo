// Współdzielony edytor opisu oferty (rich-text + układ sekcji TEXT/IMAGE).
// Używany przez edytor Allegro i Erli, żeby edytor tekstu wyglądał i działał
// identycznie na obu platformach (opis Erli ma tę samą strukturę
// `description.sections[].items[]` co Allegro). Wydzielone 1:1 z AllegroOfferEditor.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bold, Eraser, ImagePlus, List, ListOrdered, Plus, Redo2, Trash2, Undo2 } from "lucide-react";

import type { JsonObject } from "../lib/commerceApi";
import { T, useI18n } from "../lib/i18n";

export type Path = (string | number)[];
export type DescriptionBlock = { type: "TEXT"; content: string } | { type: "IMAGE"; url: string };
export type DescriptionRow = DescriptionBlock[];

const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";

const ALLOWED_DESCRIPTION_TAGS = new Set(["H1", "H2", "P", "UL", "OL", "LI", "B"]);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeDescriptionNode(node: Node, parent: HTMLElement, documentRef: Document): void {
  if (node.nodeType === Node.TEXT_NODE) {
    parent.appendChild(documentRef.createTextNode(node.textContent ?? ""));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as HTMLElement;
  const tag = element.tagName === "STRONG" ? "B" : element.tagName === "DIV" ? "P" : element.tagName;

  if (!ALLOWED_DESCRIPTION_TAGS.has(tag)) {
    Array.from(element.childNodes).forEach((child) => sanitizeDescriptionNode(child, parent, documentRef));
    return;
  }

  const next = documentRef.createElement(tag.toLowerCase());
  Array.from(element.childNodes).forEach((child) => sanitizeDescriptionNode(child, next, documentRef));
  parent.appendChild(next);
}

function normalizeDescriptionHtml(value: string): string {
  if (typeof document === "undefined") {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\s(?:class|style|data-[a-z0-9_-]+)="[^"]*"/gi, "")
      .replace(/<\/?strong(\s[^>]*)?>/gi, (tag) => tag.startsWith("</") ? "</b>" : "<b>")
      .replace(/<div(\s[^>]*)?>/gi, "<p>")
      .replace(/<\/div>/gi, "</p>")
      .replace(/<\/?(?!h1|h2|p|ul|ol|li|b)\w+[^>]*>/gi, "")
      .trim();
  }

  const template = document.createElement("template");
  template.innerHTML = value;
  const clean = document.createElement("div");
  Array.from(template.content.childNodes).forEach((node) => sanitizeDescriptionNode(node, clean, document));

  const normalized = document.createElement("div");
  let inlineBucket: HTMLParagraphElement | null = null;
  Array.from(clean.childNodes).forEach((node) => {
    const tag = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement).tagName : "";
    const isAllowedBlock = ["H1", "H2", "P", "UL", "OL"].includes(tag);
    if (isAllowedBlock) {
      inlineBucket = null;
      normalized.appendChild(node);
      return;
    }
    const textValue = node.textContent ?? "";
    if (!textValue.trim() && node.nodeType === Node.TEXT_NODE) return;
    inlineBucket ??= document.createElement("p");
    inlineBucket.appendChild(node);
    if (!inlineBucket.parentElement) normalized.appendChild(inlineBucket);
  });

  Array.from(normalized.querySelectorAll("h1,h2,li")).forEach((element) => {
    if (!element.textContent?.trim()) element.remove();
  });
  Array.from(normalized.querySelectorAll("ul,ol")).forEach((element) => {
    if (!element.querySelector("li")) element.remove();
  });

  return normalized.innerHTML.replace(/<p>\s*<\/p>/gi, "<p></p>").trim();
}

export function cleanOfferHtml(value: string): string {
  return normalizeDescriptionHtml(value);
}

export function stripHtml(value: string): string {
  return cleanOfferHtml(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function descriptionItem(item: JsonObject): DescriptionBlock {
  if (text(item.type) === "IMAGE") return { type: "IMAGE", url: text(item.url) };
  return { type: "TEXT", content: text(item.content) || "<p></p>" };
}

function descriptionRows(sections: JsonObject[]): DescriptionRow[] {
  const rows = sections
    .map((section) => array(section.items).map(object).map(descriptionItem).slice(0, 2))
    .filter((row) => row.length > 0);
  return rows.length > 0 ? rows : [[{ type: "TEXT", content: "<p></p>" }]];
}

export function descriptionBlocks(sections: JsonObject[]): DescriptionBlock[] {
  return descriptionRows(sections).flat();
}

function sectionItem(block: DescriptionBlock): JsonObject {
  return block.type === "IMAGE"
    ? { type: "IMAGE", url: block.url }
    : { type: "TEXT", content: cleanOfferHtml(block.content) || "<p></p>" };
}

function sectionsFromDescriptionRows(rows: DescriptionRow[]): JsonObject[] {
  const sections = rows
    .map((row) => row
      .filter((block) => block.type === "TEXT" || Boolean(block.url))
      .slice(0, 2)
      .map(sectionItem))
    .filter((items) => items.length > 0)
    .map((items) => ({ items }));
  return sections.length > 0 ? sections : [{ items: [{ type: "TEXT", content: "<p></p>" }] }];
}

export function sectionsFromDescriptionBlocks(blocks: DescriptionBlock[]): JsonObject[] {
  return sectionsFromDescriptionRows(blocks.map((block) => [block]));
}

function descriptionBlockLabel(block: DescriptionBlock, imageIndex: number, t: (key: T) => string): string {
  if (block.type === "IMAGE") return `${t(T.offer_image_label)} ${imageIndex + 1}`;
  return t(T.offer_add_text);
}

export function descriptionHasContent(sections: JsonObject[]): boolean {
  return sections.some((section) => array(section.items).map(object).some((item) => {
    if (text(item.type) === "IMAGE") return Boolean(text(item.url).trim());
    return stripHtml(text(item.content)).length > 0;
  }));
}

// Normalizuje pole `description` (string albo obiekt {sections}) do listy sekcji dla
// edytora. Erli zwraca opis raz jako zwykły tekst, raz jako strukturę jak w Allegro.
export function descriptionSectionsFrom(value: unknown): JsonObject[] {
  if (typeof value === "string") {
    const html = /<[a-z][\s\S]*>/i.test(value) ? cleanOfferHtml(value) : (value.trim() ? `<p>${escapeHtml(value.trim())}</p>` : "");
    return html ? [{ items: [{ type: "TEXT", content: html }] }] : [{ items: [{ type: "TEXT", content: "<p></p>" }] }];
  }
  const sections = array(object(value).sections).map(object);
  return sections.length > 0 ? sections : [{ items: [{ type: "TEXT", content: "<p></p>" }] }];
}

export function RichDescriptionEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const editorRef = useRef<HTMLDivElement>(null);
  const historyAnchorRef = useRef(cleanOfferHtml(value) || "<p></p>");
  const typingChunkOpenRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState({ bold: false, block: "p", unordered: false, ordered: false });
  const [history, setHistory] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);

  const readHtml = () => cleanOfferHtml(editorRef.current?.innerHTML ?? "") || "<p></p>";
  const remember = (snapshot = readHtml()) => {
    setHistory((items) => {
      if (items[items.length - 1] === snapshot) return items;
      return [...items.slice(-39), snapshot];
    });
    setFuture([]);
    historyAnchorRef.current = snapshot;
    typingChunkOpenRef.current = false;
  };
  const applyHistory = (html: string) => {
    const next = cleanOfferHtml(html) || "<p></p>";
    if (editorRef.current) editorRef.current.innerHTML = next;
    historyAnchorRef.current = next;
    typingChunkOpenRef.current = false;
    onChange(next);
    requestAnimationFrame(refreshState);
  };
  const undoHistory = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    const current = readHtml();
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [current, ...items]);
    applyHistory(previous);
  };
  const redoHistory = () => {
    const next = future[0];
    if (!next) return;
    const current = readHtml();
    setFuture((items) => items.slice(1));
    setHistory((items) => [...items.slice(-39), current]);
    applyHistory(next);
  };

  const currentBlock = useCallback((): HTMLElement | null => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!editor || !node || !editor.contains(node)) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement;
    return element?.closest("h1,h2,p,li") ?? null;
  }, []);

  const refreshState = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!editor || !selection || !node || !editor.contains(node)) {
      return;
    }

    const blockElement = currentBlock();
    const tag = blockElement?.tagName.toLowerCase();
    const parentTag = blockElement?.parentElement?.tagName.toLowerCase();
    const block = tag === "h1" || tag === "h2" ? tag : "p";
    const unordered = tag === "li" && parentTag === "ul";
    const ordered = tag === "li" && parentTag === "ol";
    setActive({ bold: document.queryCommandState("bold"), block, unordered, ordered });
  }, [currentBlock]);

  useLayoutEffect(() => {
    const element = editorRef.current;
    if (!element || focused) return;
    const next = cleanOfferHtml(value) || "<p></p>";
    if (element.innerHTML !== next) element.innerHTML = next;
    historyAnchorRef.current = next;
  }, [focused, value]);

  useEffect(() => {
    document.addEventListener("selectionchange", refreshState);
    return () => document.removeEventListener("selectionchange", refreshState);
  }, [refreshState]);

  const emit = (syncDom = false) => {
    const editor = editorRef.current;
    const html = cleanOfferHtml(editor?.innerHTML ?? "");
    if (syncDom && editor && editor.innerHTML !== (html || "<p></p>")) editor.innerHTML = html || "<p></p>";
    onChange(html || "<p></p>");
    return html || "<p></p>";
  };
  const emitTyping = () => {
    const html = emit();
    if (!typingChunkOpenRef.current) {
      remember(historyAnchorRef.current);
      typingChunkOpenRef.current = true;
    }
    const delta = Math.abs(stripHtml(html).length - stripHtml(historyAnchorRef.current).length);
    if (delta >= 80) {
      historyAnchorRef.current = html;
      typingChunkOpenRef.current = false;
    }
    refreshState();
  };
  const command = (name: string, argument?: string) => {
    editorRef.current?.focus();
    remember();
    document.execCommand(name, false, argument);
    historyAnchorRef.current = emit(true);
    typingChunkOpenRef.current = false;
    requestAnimationFrame(refreshState);
  };
  const toolbarCommand = (event: React.MouseEvent, name: string, argument?: string) => {
    event.preventDefault();
    command(name, argument);
  };
  const clearFormatting = (event: React.MouseEvent) => {
    event.preventDefault();
    remember();
    const selection = window.getSelection();
    const editor = editorRef.current;
    if (editor && selection && !selection.isCollapsed && selection.anchorNode && editor.contains(selection.anchorNode)) {
      document.execCommand("removeFormat");
    } else if (editor) {
      const plain = stripHtml(editor.innerHTML);
      editor.innerHTML = plain ? `<p>${escapeHtml(plain)}</p>` : "<p></p>";
    }
    historyAnchorRef.current = emit(true);
    typingChunkOpenRef.current = false;
    requestAnimationFrame(refreshState);
  };
  const insertHtml = (html: string) => {
    remember();
    document.execCommand("insertHTML", false, html);
    historyAnchorRef.current = emit(true);
    typingChunkOpenRef.current = false;
    requestAnimationFrame(refreshState);
  };
  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const plain = event.clipboardData.getData("text/plain");
    if (html) {
      insertHtml(cleanOfferHtml(html) || `<p>${escapeHtml(plain)}</p>`);
      return;
    }
    const paragraphs = plain
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => `<p>${escapeHtml(part).replace(/\n/g, " ")}</p>`)
      .join("");
    insertHtml(paragraphs || "<p></p>");
  };
  const handleMarkdownShortcut = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redoHistory();
      else undoHistory();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redoHistory();
      return;
    }
    if (event.key !== " ") return;
    const block = currentBlock();
    const marker = block?.textContent?.replace(/\u00a0/g, " ").trim();
    if (!block || !["#", "##", "*", "-", "1."].includes(marker ?? "")) return;
    event.preventDefault();
    remember();
    block.innerHTML = "";
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (marker === "#") command("formatBlock", "h1");
    else if (marker === "##") command("formatBlock", "h2");
    else if (marker === "1.") command("insertOrderedList");
    else command("insertUnorderedList");
  };

  return <div className="offer-rich-editor">
    <div className="offer-rich-toolbar" role="toolbar" aria-label={t(T.offer_description_toolbar)}>
      <div className="offer-rich-toolbar-section">
        <select className="input offer-rich-format" value={active.block} aria-label={t(T.offer_description_block_format)} onChange={(event) => command("formatBlock", event.target.value)}>
          <option value="p">{t(T.offer_description_paragraph)}</option>
          <option value="h1">H1</option>
          <option value="h2">H2</option>
        </select>
      </div>
      <div className="offer-rich-toolbar-section">
        <button type="button" className="btn btn-ghost btn-icon" disabled={history.length === 0} title={t(T.offer_description_undo)} onMouseDown={(event) => { event.preventDefault(); undoHistory(); }}><Undo2 size={16} /></button>
        <button type="button" className="btn btn-ghost btn-icon" disabled={future.length === 0} title={t(T.offer_description_redo)} onMouseDown={(event) => { event.preventDefault(); redoHistory(); }}><Redo2 size={16} /></button>
      </div>
      <div className="offer-rich-toolbar-section">
        <button type="button" className={`btn btn-ghost btn-icon${active.bold ? " active" : ""}`} title={t(T.offer_description_bold)} onMouseDown={(event) => toolbarCommand(event, "bold")}><Bold size={16} /></button>
      </div>
      <div className="offer-rich-toolbar-section">
        <button type="button" className={`btn btn-ghost btn-icon${active.unordered ? " active" : ""}`} title={t(T.offer_description_bulleted_list)} onMouseDown={(event) => toolbarCommand(event, "insertUnorderedList")}><List size={16} /></button>
        <button type="button" className={`btn btn-ghost btn-icon${active.ordered ? " active" : ""}`} title={t(T.offer_description_numbered_list)} onMouseDown={(event) => toolbarCommand(event, "insertOrderedList")}><ListOrdered size={16} /></button>
      </div>
      <button type="button" className="btn btn-ghost btn-icon" title={t(T.offer_description_clear)} onMouseDown={clearFormatting}><Eraser size={16} /></button>
    </div>
    <div
      ref={editorRef}
      className="offer-rich-surface"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={t(T.offer_field_description)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); emit(true); }}
      onInput={emitTyping}
      onKeyDown={handleMarkdownShortcut}
      onKeyUp={refreshState}
      onMouseUp={refreshState}
      onPaste={handlePaste}
    />
  </div>;
}

export function DescriptionSectionsEditor({ sections, images, set }: { sections: JsonObject[]; images: string[]; set: (path: Path, value: unknown) => void }) {
  const { t } = useI18n();
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const imageOptions = images.filter(Boolean);
  const blocks = descriptionBlocks(sections);
  const chars = blocks.reduce((sum, block) => sum + (block.type === "TEXT" ? stripHtml(block.content).length : 0), 0);
  const setBlocks = (next: DescriptionBlock[]) => set(["description", "sections"], sectionsFromDescriptionBlocks(next));
  const updateBlock = (index: number, patch: Partial<DescriptionBlock>) => {
    setBlocks(blocks.map((block, currentIndex) => currentIndex === index ? { ...block, ...patch } as DescriptionBlock : block));
  };
  const removeBlock = (index: number) => {
    const next = blocks.filter((_, currentIndex) => currentIndex !== index);
    setBlocks(next.length > 0 ? next : [{ type: "TEXT", content: "<p></p>" }]);
  };
  const moveBlock = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    setBlocks(next);
  };
  const appendBlock = (block: DescriptionBlock) => setBlocks([...blocks, block]);
  const confirmDelete = () => {
    if (deleteIndex == null) return;
    removeBlock(deleteIndex);
    setDeleteIndex(null);
  };
  return <section>
    <div className="offer-description-heading"><h3>{t(T.offer_field_description)}</h3><span>{t(T.offer_description_chars, { n: chars })}</span></div>
    <div className="offer-description-flow">
      {blocks.map((block, index) => {
        const imageIndex = block.type === "IMAGE" ? imageOptions.indexOf(block.url) : -1;
        return <div className="offer-description-flow-entry" key={`${block.type}-${index}`}>
          <div className={`offer-description-flow-item ${block.type === "IMAGE" ? "image" : "text"}`}>
            <div className="offer-description-order">
              <span>{index + 1}</span>
              <button type="button" className="btn btn-ghost btn-icon" disabled={index === 0} title={t(T.offer_move_left)} onClick={() => moveBlock(index, -1)}><ArrowUp size={13} /></button>
              <button type="button" className="btn btn-ghost btn-icon" disabled={index === blocks.length - 1} title={t(T.offer_move_right)} onClick={() => moveBlock(index, 1)}><ArrowDown size={13} /></button>
            </div>
            <div className="offer-description-flow-content">
              {block.type === "IMAGE" ? <div className="offer-description-image-frame">
              {block.url && <img src={block.url} alt="" />}
              <div className="offer-description-image-tools">
                <select className="input offer-description-image-select" value={block.url} aria-label={descriptionBlockLabel(block, Math.max(imageIndex, 0), t)} onChange={(event) => updateBlock(index, { url: event.target.value })}>
                  <option value="">{t(T.common_none_dash)}</option>
                  {[block.url, ...imageOptions].filter(Boolean).filter((value, optionIndex, values) => values.indexOf(value) === optionIndex).map((url) => {
                    const currentImageIndex = imageOptions.indexOf(url);
                    return <option key={url} value={url}>{currentImageIndex >= 0 ? `${t(T.offer_image_label)} ${currentImageIndex + 1}` : url}</option>;
                  })}
                </select>
                {blocks.length > 1 && <button type="button" className="btn btn-ghost btn-icon danger" title={t(T.common_delete)} onClick={() => setDeleteIndex(index)}><Trash2 size={14} /></button>}
              </div>
            </div> : <div className="offer-description-text-frame">
              <RichDescriptionEditor value={block.content} onChange={(value) => updateBlock(index, { content: value })} />
              {blocks.length > 1 && <button type="button" className="btn btn-ghost btn-icon danger offer-description-remove" title={t(T.common_delete)} onClick={() => setDeleteIndex(index)}><Trash2 size={14} /></button>}
            </div>}
            </div>
          </div>
        </div>;
      })}
      <div className="offer-description-insert">
        <span />
        <button type="button" className="btn btn-ghost compact" onClick={() => appendBlock({ type: "TEXT", content: "<p></p>" })}><Plus size={14} />{t(T.offer_add_text)}</button>
        <button type="button" className="btn btn-ghost compact" onClick={() => appendBlock({ type: "IMAGE", url: imageOptions[0] ?? "" })}><ImagePlus size={14} />{t(T.offer_add_description_image)}</button>
        <span />
      </div>
    </div>
    {deleteIndex != null && <div className="offer-overlay-backdrop" role="dialog" aria-modal="true">
      <div className="offer-confirm-dialog">
        <h3>{t(T.offer_delete_description_confirm)}</h3>
        <footer><button type="button" className="btn btn-secondary" onClick={() => setDeleteIndex(null)}>{t(T.common_cancel)}</button><button type="button" className="btn btn-primary" onClick={confirmDelete}>{t(T.common_delete)}</button></footer>
      </div>
    </div>}
  </section>;
}

import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Highlighter, Italic, Link2, List, ListOrdered, Redo2, RemoveFormatting,
  Strikethrough, Underline as UnderlineIcon, Undo2, Unlink,
} from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

const HIGHLIGHTS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca'];
const COLOURS = ['#111827', '#1d4ed8', '#047857', '#b91c1c', '#7c3aed'];

/** Rich-text body for emails (TipTap). Produces plain, email-safe HTML; no HTML knowledge needed. */
export function RichEditor({ html, version, onChange, placeholder }: { html: string; version: number; onChange: (html: string) => void; placeholder?: string }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline, TextStyle, Color, Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write your message…' }),
    ],
    content: html,
    editorProps: { attributes: { class: 'email-editor min-h-[14rem] px-3 py-2 text-sm focus:outline-none', 'aria-label': 'Message', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? '' : e.getHTML()),
  });
  // Reload when the content is replaced from outside (prefill / reset), not on every keystroke.
  useEffect(() => { if (editor && version) editor.commands.setContent(html || '', false); }, [version, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded-md border border-slate-300 focus-within:border-slate-500">
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Btn({ on, active, label, children, disabled }: { on: () => void; active?: boolean; label: string; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={on}
      className={`rounded p-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40 ${active ? 'bg-slate-200 text-slate-900' : ''}`}>{children}</button>
  );
}
const Sep = () => <span className="mx-0.5 h-5 w-px self-center bg-slate-200" aria-hidden />;

function Toolbar({ editor }: { editor: Editor }) {
  const c = () => editor.chain().focus();
  const block = editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p';
  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link address (https://…)', prev ?? 'https://');
    if (url === null) return;
    if (!url.trim() || url.trim() === 'https://') { c().extendMarkRange('link').unsetLink().run(); return; }
    const href = /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    c().extendMarkRange('link').setLink({ href }).run();
  };
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-1 py-1" role="toolbar" aria-label="Formatting">
      <Btn label="Undo" on={() => c().undo().run()} disabled={!editor.can().undo()}><Undo2 size={15} /></Btn>
      <Btn label="Redo" on={() => c().redo().run()} disabled={!editor.can().redo()}><Redo2 size={15} /></Btn>
      <Sep />
      <select aria-label="Text style" className="rounded border border-slate-200 bg-white px-1 py-1 text-xs" value={block}
        onChange={(e) => { const v = e.target.value; if (v === 'p') c().setParagraph().run(); else c().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run(); }}>
        <option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option>
      </select>
      <Sep />
      <Btn label="Bold (Ctrl+B)" active={editor.isActive('bold')} on={() => c().toggleBold().run()}><Bold size={15} /></Btn>
      <Btn label="Italic (Ctrl+I)" active={editor.isActive('italic')} on={() => c().toggleItalic().run()}><Italic size={15} /></Btn>
      <Btn label="Underline (Ctrl+U)" active={editor.isActive('underline')} on={() => c().toggleUnderline().run()}><UnderlineIcon size={15} /></Btn>
      <Btn label="Strikethrough" active={editor.isActive('strike')} on={() => c().toggleStrike().run()}><Strikethrough size={15} /></Btn>
      <Sep />
      <Btn label="Bulleted list" active={editor.isActive('bulletList')} on={() => c().toggleBulletList().run()}><List size={15} /></Btn>
      <Btn label="Numbered list" active={editor.isActive('orderedList')} on={() => c().toggleOrderedList().run()}><ListOrdered size={15} /></Btn>
      <Sep />
      <Btn label="Align left" active={editor.isActive({ textAlign: 'left' })} on={() => c().setTextAlign('left').run()}><AlignLeft size={15} /></Btn>
      <Btn label="Align centre" active={editor.isActive({ textAlign: 'center' })} on={() => c().setTextAlign('center').run()}><AlignCenter size={15} /></Btn>
      <Btn label="Align right" active={editor.isActive({ textAlign: 'right' })} on={() => c().setTextAlign('right').run()}><AlignRight size={15} /></Btn>
      <Btn label="Justify" active={editor.isActive({ textAlign: 'justify' })} on={() => c().setTextAlign('justify').run()}><AlignJustify size={15} /></Btn>
      <Sep />
      <Btn label="Add or edit link" active={editor.isActive('link')} on={setLink}><Link2 size={15} /></Btn>
      <Btn label="Remove link" on={() => c().unsetLink().run()} disabled={!editor.isActive('link')}><Unlink size={15} /></Btn>
      <Sep />
      <span className="flex items-center gap-0.5" title="Highlight">
        <Highlighter size={14} className="mx-0.5 text-slate-500" aria-hidden />
        {HIGHLIGHTS.map((h) => <button key={h} type="button" aria-label={`Highlight ${h}`} onMouseDown={(e) => e.preventDefault()} onClick={() => c().toggleHighlight({ color: h }).run()} className="h-4 w-4 rounded border border-slate-300" style={{ background: h }} />)}
      </span>
      <span className="flex items-center gap-0.5 pl-1" title="Text colour">
        <span className="mx-0.5 text-xs font-semibold text-slate-500" aria-hidden>A</span>
        {COLOURS.map((h) => <button key={h} type="button" aria-label={`Text colour ${h}`} onMouseDown={(e) => e.preventDefault()} onClick={() => c().setColor(h).run()} className="h-4 w-4 rounded-full border border-slate-300" style={{ background: h }} />)}
      </span>
      <Sep />
      <Btn label="Clear formatting" on={() => c().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={15} /></Btn>
    </div>
  );
}

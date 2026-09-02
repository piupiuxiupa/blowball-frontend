import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import { Node, mergeAttributes } from '@tiptap/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Table as TableIcon,
  Undo2,
  Redo2,
  Save,
} from 'lucide-react';
import { getPreviewUrl } from '@/hooks/use-file-content';
import { saveOfficeFile, DOCX_MIME } from '@/lib/office/save';
import { useUIStore } from '@/stores/ui-store';
import { useFileEditStore } from '@/stores/file-edit-store';
import { officeEngine, OfficeEngineError } from '@/lib/office/worker/client';
import { blocksToPmDoc, pmDocToSaveBlocks } from '@/lib/office/docx/pm-convert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { WordViewer } from './word-viewer';

/** Read-only passthrough chip: protected OOXML the lean editor cannot model. */
const DocxPassthrough = Node.create({
  name: 'docxPassthrough',
  group: 'block',
  atom: true,
  draggable: false,
  addAttributes() {
    return {
      docxIndex: { default: null },
      label: { default: '受保护内容' },
      preview: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-docx-passthrough]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-docx-passthrough': '' }),
      [
        'div',
        { class: 'my-3 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground' },
        `${HTMLAttributes.label ?? ''}${HTMLAttributes.preview ? `：${String(HTMLAttributes.preview).slice(0, 80)}` : ''}`,
      ],
    ];
  },
});

const DocxParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      docxIndex: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-docx-index'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.docxIndex != null ? { 'data-docx-index': attrs.docxIndex } : {},
      },
    };
  },
});

const DocxHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      docxIndex: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-docx-index'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.docxIndex != null ? { 'data-docx-index': attrs.docxIndex } : {},
      },
    };
  },
});

interface DocxEditorProps {
  path: string;
  refreshKey?: number;
  /** Optional pre-fetched bytes (historical version preview); skips the path fetch. */
  bytes?: Uint8Array;
  /** Force read-only (historical version preview ignores the global edit mode). */
  readOnly?: boolean;
}

interface ParsedState {
  doc: Omit<import('@/vendor/genoffice/docx-engine').ParsedDoc, 'internal'>;
  handle: number;
  originalBlocks: import('@/vendor/genoffice/docx-engine').ParsedDoc['blocks'];
}

async function fetchOfficeBytes(path: string, refreshKey: number): Promise<Uint8Array> {
  const res = await fetch(getPreviewUrl(path, refreshKey));
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export function DocxEditor({
  path,
  refreshKey = 0,
  bytes: bytesOverride,
  readOnly = false,
}: DocxEditorProps) {
  const viewMode = useUIStore((s) => s.fileViewMode);
  const editable = !readOnly && viewMode === 'edit';
  const markDirty = useFileEditStore((s) => s.markDirty);
  const setSaving = useFileEditStore((s) => s.setSaving);
  const queryClient = useQueryClient();
  const [parsed, setParsed] = useState<ParsedState | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const handleRef = useRef<number | null>(null);

  const bytesQuery = useQuery({
    queryKey: ['office-bytes', path, refreshKey],
    queryFn: () => fetchOfficeBytes(path, refreshKey),
    staleTime: Infinity,
    enabled: bytesOverride === undefined,
  });
  const loadedBytes = bytesOverride ?? bytesQuery.data;

  useEffect(() => {
    if (!loadedBytes) return;
    let cancelled = false;
    setParseError(null);
    setFallbackUrl(null);
    const bytes = loadedBytes;
    officeEngine
      .parseDocx(bytes)
      .then((result) => {
        if (cancelled) return;
        handleRef.current = result.handle;
        setParsed({ doc: result.doc, handle: result.handle, originalBlocks: result.doc.blocks });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setParseError(e instanceof OfficeEngineError ? e.message : String(e));
        try {
          setFallbackUrl(URL.createObjectURL(new Blob([bytes as BlobPart])));
        } catch {
          setFallbackUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadedBytes]);

  useEffect(() => {
    return () => {
      if (handleRef.current != null) officeEngine.dispose(handleRef.current);
      markDirty(path, false);
    };
  }, [path, markDirty]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          paragraph: false,
          heading: false,
        }),
        DocxParagraph,
        DocxHeading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
        Underline,
        Image.configure({ inline: true, allowBase64: true }),
        Table.configure({ resizable: false }),
        TableRow,
        TableCell,
        TableHeader,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        DocxPassthrough,
      ],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      editable,
      onUpdate: () => markDirty(path, true),
    },
    [path],
  );

  // Mount parsed content once per document.
  const mountedKey = useRef<string>('');
  useEffect(() => {
    if (!editor || !parsed) return;
    const key = `${path}::${parsed.handle}`;
    if (mountedKey.current === key) return;
    mountedKey.current = key;
    editor.commands.setContent({ type: 'doc', content: blocksToPmDoc(parsed.doc) });
    markDirty(path, false);
  }, [editor, parsed, path, markDirty]);

  useEffect(() => {
    editor?.setEditable(!readOnly && viewMode === 'edit');
  }, [editor, viewMode, readOnly]);

  const save = useCallback(async () => {
    if (!editor || !parsed) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body = editor.getJSON().content ?? [];
      const saveBlocks = pmDocToSaveBlocks(body, parsed.doc);
      const bytes = await officeEngine.saveDocx(parsed.handle, saveBlocks);
      const outcome = await saveOfficeFile({
        path,
        bytes,
        originalBytes: bytesOverride ?? bytesQuery.data ?? null,
        mime: DOCX_MIME,
      });
      if (outcome === 'saved') {
        markDirty(path, false);
        await queryClient.invalidateQueries({ queryKey: ['workspace'] });
        await queryClient.invalidateQueries({ queryKey: ['office-bytes', path] });
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [editor, parsed, path, markDirty, queryClient, setSaving]);

  const toolbar = useMemo(() => {
    if (!editor) return null;
    const groups: Array<Array<{ icon: React.ReactNode; title: string; active?: boolean; onClick: () => void }>> = [
      [
        { icon: <Bold size={14} />, title: '加粗', active: editor.isActive('bold'), onClick: () => editor.chain().focus().toggleBold().run() },
        { icon: <Italic size={14} />, title: '斜体', active: editor.isActive('italic'), onClick: () => editor.chain().focus().toggleItalic().run() },
        { icon: <UnderlineIcon size={14} />, title: '下划线', active: editor.isActive('underline'), onClick: () => editor.chain().focus().toggleUnderline().run() },
      ],
      [
        { icon: <span className="text-[10px] font-bold">H1</span>, title: '标题 1', active: editor.isActive('heading', { level: 1 }), onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
        { icon: <span className="text-[10px] font-bold">H2</span>, title: '标题 2', active: editor.isActive('heading', { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
        { icon: <span className="text-[10px] font-bold">H3</span>, title: '标题 3', active: editor.isActive('heading', { level: 3 }), onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
      ],
      [
        { icon: <List size={14} />, title: '无序列表', active: editor.isActive('bulletList'), onClick: () => editor.chain().focus().toggleBulletList().run() },
        { icon: <ListOrdered size={14} />, title: '有序列表', active: editor.isActive('orderedList'), onClick: () => editor.chain().focus().toggleOrderedList().run() },
      ],
      [
        { icon: <AlignLeft size={14} />, title: '左对齐', active: editor.isActive({ textAlign: 'left' }), onClick: () => editor.chain().focus().setTextAlign('left').run() },
        { icon: <AlignCenter size={14} />, title: '居中', active: editor.isActive({ textAlign: 'center' }), onClick: () => editor.chain().focus().setTextAlign('center').run() },
        { icon: <AlignRight size={14} />, title: '右对齐', active: editor.isActive({ textAlign: 'right' }), onClick: () => editor.chain().focus().setTextAlign('right').run() },
      ],
      [
        { icon: <TableIcon size={14} />, title: '插入表格', onClick: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      ],
      [
        { icon: <Undo2 size={14} />, title: '撤销', onClick: () => editor.chain().focus().undo().run() },
        { icon: <Redo2 size={14} />, title: '重做', onClick: () => editor.chain().focus().redo().run() },
      ],
    ];
    return groups;
  }, [editor]);

  if (!loadedBytes || (parsed === null && parseError === null)) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (parseError) {
    if (fallbackUrl) {
      return (
        <div className="flex h-full flex-col">
          <div className="border-b border-border bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
            高保真解析失败（{parseError}），已切换只读模式
          </div>
          <div className="min-h-0 flex-1">
            <WordViewer path={path} url={fallbackUrl} />
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">
        文档解析失败：{parseError}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {editable && editor && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1">
          {toolbar?.map((group, gi) => (
            <div key={gi} className="flex items-center gap-0.5 border-r border-border pr-1 last:border-r-0">
              {group.map((item) => (
                <Button
                  key={item.title}
                  variant="ghost"
                  size="icon"
                  title={item.title}
                  className={`h-7 w-7 ${item.active ? 'bg-muted' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={item.onClick}
                >
                  {item.icon}
                </Button>
              ))}
            </div>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {saveError && <span className="text-xs text-destructive">{saveError}</span>}
            <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => void save()}>
              <Save size={14} /> 保存
            </Button>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-auto bg-muted/30 p-6">
        <div className="mx-auto max-w-3xl rounded-lg bg-background px-10 py-8 shadow-sm">
          <EditorContent editor={editor} className="docx-editor-content" />
        </div>
      </div>
    </div>
  );
}

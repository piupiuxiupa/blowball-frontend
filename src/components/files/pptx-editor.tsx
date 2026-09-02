import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stage, Layer, Rect, Group, Transformer } from 'react-konva';
import type Konva from 'konva';
import { ChevronLeft, ChevronRight, Square, Type, Trash2, Save, ImagePlus } from 'lucide-react';
import { apiUpload } from '@/lib/api';
import { getPreviewUrl } from '@/hooks/use-file-content';
import { useUIStore } from '@/stores/ui-store';
import { useFileEditStore } from '@/stores/file-edit-store';
import { officeEngine, OfficeEngineError } from '@/lib/office/worker/client';
import type { PptxEditOp, PptxParseResult } from '@/lib/office/worker/messages';
import { NodeBody } from '@/vendor/genoffice/pptx-konva/NodeBody';
import { boxPivotProps } from '@/vendor/genoffice/pptx-konva/konva-adapter';
import type { RenderNode, RenderSlide } from '@/vendor/genoffice/pptx-render';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const FIT_WIDTH_PX = 960;
const EMU_PER_PX = 9525;

interface PptxEditorProps {
  path: string;
  refreshKey?: number;
}

async function fetchOfficeBytes(path: string, refreshKey: number): Promise<Uint8Array> {
  const res = await fetch(getPreviewUrl(path, refreshKey));
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function collectImageUrls(nodes: RenderNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.type === 'picture' && 'dataUrl' in node && node.dataUrl) out.add(node.dataUrl);
    const fill = (node as { fill?: { dataUrl?: string } }).fill;
    if (fill?.dataUrl) out.add(fill.dataUrl);
    if (node.type === 'group') {
      collectImageUrls((node as unknown as { children: RenderNode[] }).children ?? [], out);
    }
  }
}

const plainTextOfNode = (node: RenderNode): string => {
  if (node.type !== 'shape' && node.type !== 'text') return '';
  const text = (node as { text?: { lines?: Array<{ runs?: Array<{ text?: string }> }> } }).text;
  return (text?.lines ?? [])
    .map((line) => (line.runs ?? []).map((r) => r.text ?? '').join(''))
    .join('\n');
};

export function PptxEditor({ path, refreshKey = 0 }: PptxEditorProps) {
  const viewMode = useUIStore((s) => s.fileViewMode);
  const markDirty = useFileEditStore((s) => s.markDirty);
  const setSaving = useFileEditStore((s) => s.setSaving);
  const queryClient = useQueryClient();
  const [state, setState] = useState<PptxParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [editingText, setEditingText] = useState<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    text: string;
  } | null>(null);
  const handleRef = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const selectedNodeRef = useRef<Konva.Group | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const editsRef = useRef<PptxEditOp[]>([]);

  const bytesQuery = useQuery({
    queryKey: ['office-bytes', path, refreshKey],
    queryFn: () => fetchOfficeBytes(path, refreshKey),
    staleTime: Infinity,
  });

  const slide: RenderSlide | undefined = state?.slides[pageIndex];

  // Load slide images (blob/data URLs) into HTMLImageElements for Konva.
  useEffect(() => {
    if (!slide) return;
    const urls = new Set<string>();
    collectImageUrls(slide.nodes, urls);
    for (const url of urls) {
      setImages((prev) => {
        if (prev.has(url)) return prev;
        const img = new Image();
        img.onload = () => setImages((cur) => new Map(cur).set(url, img));
        img.src = url;
        return new Map(prev);
      });
    }
  }, [slide]);

  const parseBytes = useCallback((bytes: Uint8Array, keepPage: number) => {
    officeEngine
      .parsePptx(bytes, FIT_WIDTH_PX)
      .then((result) => {
        if (handleRef.current != null) officeEngine.dispose(handleRef.current);
        handleRef.current = result.handle;
        setState(result);
        setPageIndex(Math.min(keepPage, result.slides.length - 1));
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof OfficeEngineError ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!bytesQuery.data) return;
    parseBytes(bytesQuery.data, 0);
  }, [bytesQuery.data, parseBytes]);

  // Register embedded fonts for drawing.
  useEffect(() => {
    if (!state) return;
    for (const face of state.fontFaces) {
      try {
        const ff = new FontFace(face.family, face.sfnt.slice().buffer as ArrayBuffer, {
          weight:
            face.style === 'bold' || face.style === 'boldItalic' ? 'bold' : 'normal',
          style:
            face.style === 'italic' || face.style === 'boldItalic' ? 'italic' : 'normal',
        });
        void ff.load().then(() => document.fonts.add(ff));
      } catch {
        // Broken embedded font: metrics estimation already covers drawing.
      }
    }
  }, [state]);

  useEffect(() => {
    return () => {
      if (handleRef.current != null) officeEngine.dispose(handleRef.current);
      markDirty(path, false);
    };
  }, [path, markDirty]);

  // Transformer follows selection.
  useEffect(() => {
    const tr = transformerRef.current;
    const node = selectedNodeRef.current;
    if (!tr) return;
    if (viewMode === 'edit' && node) {
      tr.nodes([node]);
      tr.getLayer()?.batchDraw();
    } else {
      tr.nodes([]);
    }
  }, [selectedId, viewMode, state, pageIndex]);

  /** Mutate deck in worker → serialize → reparse, keeping visual state consistent. */
  const applyEdits = useCallback(
    async (ops: PptxEditOp[]) => {
      const handle = handleRef.current;
      if (handle == null || ops.length === 0) return;
      const keepPage = pageIndex;
      editsRef.current.push(...ops);
      markDirty(path, true);
      try {
        const bytes = await officeEngine.savePptx(handle, ops);
        parseBytes(bytes, keepPage);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    },
    [pageIndex, path, markDirty, parseBytes],
  );

  const save = useCallback(async () => {
    const handle = handleRef.current;
    if (handle == null || editsRef.current.length === 0) {
      markDirty(path, false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const bytes = await officeEngine.savePptx(handle, []);
      const fileName = path.split('/').pop() ?? 'deck.pptx';
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const file = new File([bytes as BlobPart], fileName, {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });
      await apiUpload('/api/v1/workspace/upload', { file, subdir: parent || undefined });
      editsRef.current = [];
      markDirty(path, false);
      await queryClient.invalidateQueries({ queryKey: ['workspace'] });
      await queryClient.invalidateQueries({ queryKey: ['office-bytes', path] });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [path, markDirty, queryClient, setSaving]);

  const onPickImage = useCallback(
    async (file: File) => {
      const ext = (file.name.split('.').pop() ?? 'png').toLowerCase();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const scale = state?.slides[pageIndex]?.scale ?? 1;
      const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX);
      if (selectedId) {
        await applyEdits([
          { op: 'replacePicture', slideIndex: pageIndex, id: selectedId, bytes, ext },
        ]);
      } else {
        await applyEdits([
          {
            op: 'addPicture',
            slideIndex: pageIndex,
            offset: { x: toEmu(160), y: toEmu(120), cx: toEmu(320), cy: toEmu(200) },
            bytes,
            ext,
          },
        ]);
      }
    },
    [applyEdits, pageIndex, selectedId, state],
  );

  const editable = viewMode === 'edit';
  const nodes = useMemo(() => slide?.nodes ?? [], [slide]);

  if (bytesQuery.isLoading || (!state && !error)) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-[540px] w-full max-w-4xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">
        演示文稿解析失败：{error}
      </div>
    );
  }

  if (!slide) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        空演示文稿
      </div>
    );
  }

  const pxToEmu = (px: number) => Math.round((px / slide.scale) * EMU_PER_PX);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="上一页"
          disabled={pageIndex === 0}
          onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
        >
          <ChevronLeft size={16} />
        </Button>
        <span className="px-1 text-xs text-muted-foreground">
          {pageIndex + 1} / {state?.slides.length ?? 0}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="下一页"
          disabled={pageIndex >= (state?.slides.length ?? 1) - 1}
          onClick={() => setPageIndex((i) => i + 1)}
        >
          <ChevronRight size={16} />
        </Button>
        {editable && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="插入矩形"
              onClick={() =>
                void applyEdits([
                  {
                    op: 'addShape',
                    slideIndex: pageIndex,
                    kind: 'rect',
                    offset: { x: pxToEmu(160), y: pxToEmu(120), cx: pxToEmu(160), cy: pxToEmu(90) },
                    fillColor: '#4F81BD',
                  },
                ])
              }
            >
              <Square size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="插入文本框"
              onClick={() =>
                void applyEdits([
                  {
                    op: 'addShape',
                    slideIndex: pageIndex,
                    kind: 'textbox',
                    offset: { x: pxToEmu(160), y: pxToEmu(240), cx: pxToEmu(320), cy: pxToEmu(60) },
                    text: '文本',
                  },
                ])
              }
            >
              <Type size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="删除选中"
              disabled={!selectedId}
              onClick={() =>
                selectedId && void applyEdits([{ op: 'delete', slideIndex: pageIndex, id: selectedId }])
              }
            >
              <Trash2 size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={selectedId ? '替换选中图片' : '插入图片'}
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus size={14} />
            </Button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onPickImage(file);
                e.target.value = '';
              }}
            />
          </>
        )}
        {state?.missingFonts.length ? (
          <span className="ml-2 text-xs text-amber-600" title={state.missingFonts.join(', ')}>
            字体缺失（{state.missingFonts.length}）
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {saveError && <span className="text-xs text-destructive">{saveError}</span>}
          {editable && (
            <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => void save()}>
              <Save size={14} /> 保存
            </Button>
          )}
        </div>
      </div>
      <div className="relative flex-1 overflow-auto bg-muted/40 p-4">
        <div className="relative mx-auto" style={{ width: slide.widthPx, height: slide.heightPx }}>
          <Stage width={slide.widthPx} height={slide.heightPx}>
            <Layer>
              <Rect x={0} y={0} width={slide.widthPx} height={slide.heightPx} fill="#ffffff" />
              {nodes.map((node) => (
                <Group
                  key={node.id}
                  {...boxPivotProps(node.box)}
                  listening={editable && !node.decoration}
                  ref={(g) => {
                    if (editable && selectedId === node.sourceId && g) selectedNodeRef.current = g;
                  }}
                  onClick={(e) => {
                    if (!editable) return;
                    e.cancelBubble = true;
                    setSelectedId(node.sourceId);
                  }}
                  draggable={editable && !node.background}
                  onDragEnd={(e) => {
                    const box = node.box;
                    void applyEdits([
                      {
                        op: 'move',
                        slideIndex: pageIndex,
                        id: node.sourceId,
                        dxEmu: pxToEmu(e.target.x() - box.x),
                        dyEmu: pxToEmu(e.target.y() - box.y),
                      },
                    ]);
                  }}
                  onTransformEnd={(e) => {
                    const n = e.target;
                    const scaleX = n.scaleX();
                    const scaleY = n.scaleY();
                    n.scaleX(1);
                    n.scaleY(1);
                    void applyEdits([
                      {
                        op: 'resize',
                        slideIndex: pageIndex,
                        id: node.sourceId,
                        offset: {
                          x: pxToEmu(n.x()),
                          y: pxToEmu(n.y()),
                          cx: pxToEmu(node.box.w * scaleX),
                          cy: pxToEmu(node.box.h * scaleY),
                        },
                      },
                    ]);
                  }}
                  onDblClick={(e) => {
                    if (node.type !== 'shape' && node.type !== 'text') return;
                    e.cancelBubble = true;
                    setEditingText({
                      id: node.sourceId,
                      x: node.box.x,
                      y: node.box.y,
                      w: node.box.w,
                      h: node.box.h,
                      text: plainTextOfNode(node),
                    });
                  }}
                >
                  <NodeBody node={node} images={images} />
                </Group>
              ))}
              {editable && <Transformer ref={transformerRef} rotateEnabled keepRatio={false} />}
            </Layer>
          </Stage>
          {editingText && (
            <textarea
              autoFocus
              className="absolute z-10 resize-none rounded border-2 border-blue-500 bg-white p-1 text-sm shadow-lg"
              style={{
                left: editingText.x,
                top: editingText.y,
                width: editingText.w,
                height: editingText.h,
              }}
              defaultValue={editingText.text}
              onBlur={(e) => {
                const lines = e.target.value.split('\n');
                void applyEdits([
                  { op: 'setText', slideIndex: pageIndex, id: editingText.id, lines },
                ]);
                setEditingText(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditingText(null);
                e.stopPropagation();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

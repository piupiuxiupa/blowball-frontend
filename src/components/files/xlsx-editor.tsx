import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { LocaleType, Univer } from '@univerjs/core';
import { defaultTheme } from '@univerjs/themes';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import zhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import { createUniver } from '@/lib/office/create-univer';
import '@univerjs/preset-sheets-core/lib/index.css';
import { Save } from 'lucide-react';
import { getPreviewUrl } from '@/hooks/use-file-content';
import { saveOfficeFile, XLSX_MIME } from '@/lib/office/save';
import { useUIStore } from '@/stores/ui-store';
import { useFileEditStore } from '@/stores/file-edit-store';
import { officeEngine } from '@/lib/office/worker/client';
import type { XlsxSheetData } from '@/lib/office/worker/messages';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ExcelViewer } from './excel-viewer';

type UniverAPI = ReturnType<typeof createUniver>['univerAPI'];

interface XlsxEditorProps {
  path: string;
  refreshKey?: number;
  /** Optional pre-fetched bytes (historical version preview); skips the path fetch. */
  bytes?: Uint8Array;
  /** Force read-only (historical version preview ignores the global edit mode). */
  readOnly?: boolean;
}

async function fetchOfficeBytes(path: string, refreshKey: number): Promise<Uint8Array> {
  const res = await fetch(getPreviewUrl(path, refreshKey));
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** SheetJS worksheet → Univer IWorkbookData.sheets entry (values, formulas, bold/italic). */
function sheetToUniverData(
  name: string,
  sheet: XLSX.WorkSheet,
): {
  id: string;
  name: string;
  cellData: Record<number, Record<number, { v?: string | number | boolean; f?: string; s?: { bl?: number; it?: number } }>>;
  rowCount: number;
  columnCount: number;
} {
  const cellData: Record<
    number,
    Record<number, { v?: string | number | boolean; f?: string; s?: { bl?: number; it?: number } }>
  > = {};
  const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
  let maxRow = 0;
  let maxCol = 0;
  if (range) {
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr] as XLSX.CellObject | undefined;
        if (!cell) continue;
        const rich: { v?: string | number | boolean; f?: string; s?: { bl?: number; it?: number } } = {};
        if (cell.t === 'n' && typeof cell.v === 'number') rich.v = cell.v;
        else if (cell.t === 'b' && typeof cell.v === 'boolean') rich.v = cell.v;
        else if (cell.v != null) rich.v = String(cell.v);
        if (typeof cell.f === 'string' && cell.f) rich.f = `=${cell.f}`;
        const bold = (cell.s as { font?: { bold?: boolean; italic?: boolean } } | undefined)?.font;
        if (bold?.bold || bold?.italic) {
          rich.s = {
            ...(bold.bold ? { bl: 1 } : {}),
            ...(bold.italic ? { it: 1 } : {}),
          };
        }
        if (Object.keys(rich).length) {
          (cellData[r] ??= {})[c] = rich;
        }
        maxRow = Math.max(maxRow, r);
        maxCol = Math.max(maxCol, c);
      }
    }
  }
  return {
    id: name,
    name,
    cellData,
    rowCount: Math.max(maxRow + 20, 50),
    columnCount: Math.max(maxCol + 5, 20),
  };
}

export function XlsxEditor({
  path,
  refreshKey = 0,
  bytes: bytesOverride,
  readOnly = false,
}: XlsxEditorProps) {
  const viewMode = useUIStore((s) => s.fileViewMode);
  const editable = !readOnly && viewMode === 'edit';
  const markDirty = useFileEditStore((s) => s.markDirty);
  const setSaving = useFileEditStore((s) => s.setSaving);
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<Univer | null>(null);
  const apiRef = useRef<UniverAPI | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  const bytesQuery = useQuery({
    queryKey: ['office-bytes', path, refreshKey],
    queryFn: () => fetchOfficeBytes(path, refreshKey),
    staleTime: Infinity,
    enabled: bytesOverride === undefined,
  });
  const loadedBytes = bytesOverride ?? bytesQuery.data;

  // Read with SheetJS → mount a Univer instance once per document.
  useEffect(() => {
    if (!loadedBytes || !containerRef.current) return;
    let disposed = false;
    setError(null);
    setFallbackUrl(null);
    try {
      const wb = XLSX.read(loadedBytes, { type: 'array', cellFormula: true, cellStyles: true });
      const sheets = wb.SheetNames.map((name) =>
        sheetToUniverData(name, wb.Sheets[name]!),
      );
      if (disposed) return;
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.ZH_CN,
        locales: { [LocaleType.ZH_CN]: zhCN as Record<string, never> },
        theme: defaultTheme,
        presets: [UniverSheetsCorePreset({ container: containerRef.current })],
      });
      univerRef.current = univer;
      apiRef.current = univerAPI;
      univerAPI.createWorkbook({
        id: 'workbook',
        name: path.split('/').pop() ?? 'workbook',
        sheetOrder: sheets.map((s) => s.id),
        sheets: Object.fromEntries(sheets.map((s) => [s.id, s])),
        styles: {},
      });
      univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => {
        if (viewModeRef.current === 'edit' && !readOnly) markDirty(path, true)
      })
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      try {
        setFallbackUrl(URL.createObjectURL(new Blob([loadedBytes as BlobPart])));
      } catch {
        setFallbackUrl(null);
      }
    }
    return () => {
      disposed = true;
      setReady(false);
      try {
        univerRef.current?.dispose();
      } catch {
        // instance may already be gone
      }
      univerRef.current = null;
      apiRef.current = null;
    };
  }, [loadedBytes, path, markDirty]);

  useEffect(() => {
    return () => markDirty(path, false);
  }, [path, markDirty]);

  const save = useCallback(async () => {
    const univerAPI = apiRef.current;
    if (!univerAPI) return;
    setSaving(true);
    setSaveError(null);
    try {
      const snapshot = univerAPI.getActiveWorkbook()?.getSnapshot();
      if (!snapshot) throw new Error('工作簿不可用');
      const sheets: XlsxSheetData[] = snapshot.sheetOrder.map((sheetId) => {
        const sheet = snapshot.sheets[sheetId]!;
        const rows: XlsxSheetData['rows'] = [];
        for (const [r, rowCells] of Object.entries(sheet.cellData ?? {})) {
          const rowIdx = Number(r);
          const rowArr = (rows[rowIdx] ??= []);
          for (const [c, cell] of Object.entries(rowCells ?? {})) {
            const data = cell as { v?: string | number | boolean; f?: string; s?: { bl?: number; it?: number } };
            const bold = data.s?.bl === 1
            const italic = data.s?.it === 1
            if (data.v == null && !data.f && !bold && !italic) continue;
            rowArr[Number(c)] = {
              ...(data.v != null ? { value: data.v as string | number | boolean } : {}),
              ...(data.f ? { formula: data.f.replace(/^=/, '') } : {}),
              ...(bold ? { bold: true } : {}),
              ...(italic ? { italic: true } : {}),
            };
          }
        }
        return { name: sheet.name ?? sheetId, rows };
      });
      const bytes = await officeEngine.saveXlsx(sheets);
      const outcome = await saveOfficeFile({
        path,
        bytes,
        originalBytes: bytesOverride ?? bytesQuery.data ?? null,
        mime: XLSX_MIME,
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
  }, [path, markDirty, queryClient, setSaving]);

  if (!loadedBytes || (!ready && !error)) {
    return <Skeleton className="m-4 h-[600px] w-full" />;
  }

  if (error) {
    if (fallbackUrl) {
      return (
        <div className="flex h-full flex-col">
          <div className="border-b border-border bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
            高保真解析失败（{error}），已切换只读模式
          </div>
          <div className="min-h-0 flex-1">
            <ExcelViewer path={path} url={fallbackUrl} />
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">
        表格解析失败：{error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {editable && (
        <div className="flex items-center justify-end border-b border-border px-2 py-1">
          {saveError && <span className="mr-2 text-xs text-destructive">{saveError}</span>}
          <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => void save()}>
            <Save size={14} /> 保存
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}

import { FileWarning, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDownloadFile } from '@/hooks/use-file-content';

interface LegacyOfficeDownloadProps {
  path: string;
  /** Version download URL (historical version preview); omit for the live file. */
  versionUrl?: string;
}

// legacy 二进制 Office（.doc/.xls/.ppt）：不渲染、不进任何编辑器，仅下载
//（spec legacy-office-download；决策：先不支持渲染，仅下载）。
export function LegacyOfficeDownload({ path, versionUrl }: LegacyOfficeDownloadProps) {
  const downloadFile = useDownloadFile(path);
  const fileName = path.split('/').pop() ?? path;

  const handleDownload = () => {
    if (versionUrl) {
      const a = document.createElement('a');
      a.href = versionUrl;
      a.download = fileName;
      a.click();
      return;
    }
    downloadFile();
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
      <FileWarning className="h-10 w-10" />
      <div className="space-y-1">
        <p className="text-sm">旧版 Office 格式不支持在线预览</p>
        <p className="text-xs">{path}</p>
      </div>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownload}>
        <Download className="h-4 w-4" />
        下载{versionUrl ? '该版本' : '文件'}
      </Button>
    </div>
  );
}

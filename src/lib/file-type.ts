export function getFileExtension(path: string): string {
  return path.split('.').pop()?.toLowerCase() || '';
}

export function isMarkdown(ext: string): boolean {
  return ext === 'md' || ext === 'markdown';
}

export function isImage(ext: string): boolean {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
}

export function isPdf(ext: string): boolean {
  return ext === 'pdf';
}

export function isHtml(ext: string): boolean {
  return ext === 'html' || ext === 'htm' || ext === 'xhtml';
}

export function isWord(ext: string): boolean {
  return ext === 'docx' || ext === 'doc';
}

export function isExcel(ext: string): boolean {
  return ext === 'xls' || ext === 'xlsx';
}

export function isSlide(ext: string): boolean {
  return ext === 'pptx' || ext === 'ppt';
}

// isOffice returns true for any extension OnlyOffice renders (word/cell/slide).
export function isOffice(ext: string): boolean {
  return isWord(ext) || isExcel(ext) || isSlide(ext);
}

// canEdit：文本/代码/Markdown/JSON/HTML/CSS 可在网页端经 Monaco + PUT /content 编辑；
// PDF / 图片 / 二进制不可编辑（不展示编辑入口）。Office 不在此判定——它经 OnlyOffice
// 自身的 edit/view 通道（见 office-viewer），由工具条统一读取 fileViewMode 切换。
//
// 以扩展名判定：已知二进制预览类型（pdf/图片）与 Office 一律不可文本编辑；其余视为
// 文本可编辑（与现有「CodeViewer 兜底所有非二进制」一致）。未知扩展的二进制文件若误入
// 编辑，保存时后端会以 400 BINARY_FILE 拒绝并提示（见 useFileEditActions 错误处理）。
export function canEdit(path: string): boolean {
  const ext = getFileExtension(path);
  return !isOffice(ext) && !isPdf(ext) && !isImage(ext);
}

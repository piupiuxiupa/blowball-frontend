// 侧边栏文件树拖拽在 dataTransfer 上承载的 mime（树内移动与「附加到消息」drop 共用）。
// PATH_MIME 是既有通道（树内移动）；PATH_TYPE_MIME 为 message-context-mentions 新增：
// 附加需要区分 file/dir，仅凭路径无从判断，拖起时随行写入。
export const PATH_MIME = 'application/x-blowball-path';
export const PATH_TYPE_MIME = 'application/x-blowball-path-type';

export interface SSEEvent {
  event: string;
  data: string;
  // 帧的 `id:` 行 = 后端 run 事件日志的 stream entry id（turn-detach-resume）。
  // 消费方记录最后收到的 id，attach 重连时以 Last-Event-ID 请求头续传，
  // 事件粒度无重放/追 live 缝隙。旧流（无 id 行）缺省。
  id?: string;
}

export async function* parseSSEStream(response: Response): AsyncGenerator<SSEEvent> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseEvent(chunk);
        if (parsed) yield parsed;
        boundary = buffer.indexOf('\n\n');
      }
    }

    // Flush any remaining content
    const remaining = decoder.decode();
    if (remaining) {
      buffer += remaining;
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseEvent(chunk);
        if (parsed) yield parsed;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(chunk: string): SSEEvent | null {
  const lines = chunk.split('\n');
  let event = '';
  let data = '';
  let id: string | undefined;

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      event = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      data = line.slice(6);
    } else if (line.startsWith('id: ')) {
      id = line.slice(4).trim();
    }
  }

  if (!event) return null;
  return { event, data, id };
}

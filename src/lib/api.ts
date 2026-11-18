import type { components, paths } from './openapi';

// The backend runs as two deployable roles that may listen on separate ports
// (see the "--role api|agent" split in cmd/blowball/serve.go):
//   - API base   → CRUD: auth, session CRUD, message history, workspace files.
//                  Default http://localhost:8080 (server.port).
//   - Agent base → streaming message turn + MCP tools.
//                  Default http://localhost:8081 (server.agent_port).
// VITE_AGENT_BASE_URL falls back to the API base so the monolith (`--role all`,
// dev, tests) and existing .env files keep working unchanged — set it only when
// running the split deployment against server.agent_port.
const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8080';
const AGENT_BASE = import.meta.env?.VITE_AGENT_BASE_URL || API_BASE;

export type ApiError = {
  error: {
    code: string;
    message: string;
    // 409 SESSION_BUSY 专属：当前运行中 turn 的 run id（attach 目标，见 openapi）。
    run_id?: string;
  };
};

export class ApiRequestError extends Error {
  code: string;
  // 409 SESSION_BUSY 时携带 body 中的 run_id，供调用方静默转 attach；
  // 其余错误路径缺省。
  runId?: string;

  constructor(code: string, message: string, runId?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.runId = runId;
  }
}

export function getApiBase(): string {
  return API_BASE.replace(/\/$/, '');
}

// Base origin for the agent role (streaming message turn + MCP tools). Falls back
// to the API base when VITE_AGENT_BASE_URL is unset.
export function getAgentBase(): string {
  return AGENT_BASE.replace(/\/$/, '');
}

export function getToken(): string | null {
  try {
    const raw = localStorage.getItem('blowball-auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { token?: string } };
    return parsed.state?.token ?? null;
  } catch {
    return null;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorBody: ApiError | null = null;
    try {
      errorBody = (await response.json()) as ApiError;
    } catch {
      // ignore parse failure
    }
    const code = errorBody?.error?.code ?? `HTTP_${response.status}`;
    const message = errorBody?.error?.message ?? response.statusText;
    throw new ApiRequestError(code, message);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
}

export async function apiGet<T>(
  path: string,
  options: { params?: Record<string, string | number | undefined>; token?: string | null } = {}
): Promise<T> {
  const url = new URL(getApiBase() + path);
  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const token = options.token ?? getToken();
  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  return handleResponse<T>(response);
}

// GET against the agent role base. The agent role serves the streaming message
// turn and the MCP tool catalogue (see the role split above), so /api/v1/mcp/tools
// must route through getAgentBase() in a split deployment; in the monolith the two
// bases are equal, so this is identical to apiGet there.
export async function apiGetAgent<T>(
  path: string,
  options: { params?: Record<string, string | number | undefined>; token?: string | null } = {}
): Promise<T> {
  const url = new URL(getAgentBase() + path);
  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const token = options.token ?? getToken();
  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  return handleResponse<T>(response);
}

export async function apiPost<T>(
  path: string,
  options: { body?: unknown; token?: string | null } = {}
): Promise<T> {
  const token = options.token ?? getToken();
  const response = await fetch(getApiBase() + path, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return handleResponse<T>(response);
}

export async function apiPut<T>(
  path: string,
  options: { body?: unknown; token?: string | null } = {}
): Promise<T> {
  const token = options.token ?? getToken();
  const response = await fetch(getApiBase() + path, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return handleResponse<T>(response);
}

export async function apiPatch<T>(
  path: string,
  options: { body?: unknown; token?: string | null } = {}
): Promise<T> {
  const token = options.token ?? getToken();
  const response = await fetch(getApiBase() + path, {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return handleResponse<T>(response);
}

export async function apiDelete<T = void>(
  path: string,
  options: { token?: string | null } = {}
): Promise<T> {
  const token = options.token ?? getToken();
  const response = await fetch(getApiBase() + path, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  return handleResponse<T>(response);
}

export async function apiPostStream(
  path: string,
  options: { body?: unknown; token?: string | null; signal?: AbortSignal } = {}
): Promise<Response> {
  const token = options.token ?? getToken();
  // Streaming turns are served by the agent role (server.agent_port), so route
  // through the agent base rather than the API/CRUD base.
  const response = await fetch(getAgentBase() + path, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (!response.ok) {
    let errorBody: ApiError | null = null;
    try {
      errorBody = (await response.clone().json()) as ApiError;
    } catch {
      // ignore
    }
    const code = errorBody?.error?.code ?? `HTTP_${response.status}`;
    const message = errorBody?.error?.message ?? response.statusText;
    // 409 SESSION_BUSY 的 body 携带运行中 run id——丢掉它调用方就只能报错，
    // 无法转 attach（turn-detach-resume 契约）。
    const runId = errorBody?.error?.run_id;
    throw new ApiRequestError(code, message, typeof runId === 'string' ? runId : undefined);
  }

  return response;
}

// 非流式 POST 走 agent base：turn 生命周期端点（如 cancel）由 agent 角色服务
// （service-roles 分区），走 apiPost 的 API base 在分体部署下会 404。单体部署
// 两 base 相同，行为与 apiPost 一致。
export async function apiPostAgent<T>(
  path: string,
  options: { body?: unknown; token?: string | null } = {}
): Promise<T> {
  const token = options.token ?? getToken();
  const response = await fetch(getAgentBase() + path, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return handleResponse<T>(response);
}

// SSE GET 走 agent base：attach 运行中 turn 的事件流（GET /turns/:run_id/events，
// turn-detach-resume）。与 POST 流同帧格式（id:/event:/data:）；lastEventId 以
// Last-Event-ID 请求头下发，实现事件粒度续传（后端保证无重放/追 live 缝隙）。
export async function apiGetStream(
  path: string,
  options: { lastEventId?: string | null; token?: string | null; signal?: AbortSignal } = {}
): Promise<Response> {
  const token = options.token ?? getToken();
  const response = await fetch(getAgentBase() + path, {
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
      ...(options.lastEventId ? { 'Last-Event-ID': options.lastEventId } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: options.signal,
  });

  if (!response.ok) {
    let errorBody: ApiError | null = null;
    try {
      errorBody = (await response.clone().json()) as ApiError;
    } catch {
      // ignore
    }
    const code = errorBody?.error?.code ?? `HTTP_${response.status}`;
    const message = errorBody?.error?.message ?? response.statusText;
    throw new ApiRequestError(code, message);
  }

  return response;
}

export async function apiUpload<T>(
  path: string,
  options: { file: File; subdir?: string; token?: string | null } = { file: new File([], '') }
): Promise<T> {
  const token = options.token ?? getToken();
  const formData = new FormData();
  formData.append('file', options.file);
  if (options.subdir) {
    formData.append('path', options.subdir);
  }

  const response = await fetch(getApiBase() + path, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  return handleResponse<T>(response);
}

// add-image-attachments：会话图片附件上传（multipart，字段名 file）。MIME 由后端
// 魔数嗅探、大小 ≤8MiB 由后端终判；此处不做客户端重编码。
export function uploadImageAttachment(sessionId: string, file: File) {
  return apiUpload<AttachmentUploadResponse>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/attachments`,
    { file }
  );
}

// 附件图片的浏览器原生加载 URL（<img> 无法携带 Authorization 头）：query-token
// + inline=1，与 workspace 预览同模式。内容不可变，可安全命中浏览器缓存。
export function getAttachmentContentUrl(sessionId: string, attachmentId: string): string {
  const token = getToken();
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  params.set('inline', '1');
  return `${getApiBase()}/api/v1/sessions/${encodeURIComponent(
    sessionId
  )}/attachments/${encodeURIComponent(attachmentId)}/content?${params.toString()}`;
}

// Re-export generated types for convenience
export type LoginRequest = paths['/api/v1/auth/login']['post']['requestBody']['content']['application/json'];
export type LoginResponse = paths['/api/v1/auth/login']['post']['responses']['200']['content']['application/json'];
export type SessionListResponse = paths['/api/v1/sessions']['get']['responses']['200']['content']['application/json'];
// 会话列表项含 generating/run_id（turn-detach-resume：运行中标记与 attach/cancel 目标，
// run_id 仅 generating 为 true 时出现）。
export type SessionListEntry = NonNullable<SessionListResponse['sessions']>[number];
// GET /api/v1/sessions/{session_id}：单会话详情（列表项超集 + create_time）。
// adapt-session-detail：其 run_id 是 run 发现的新鲜探测通道（打开/聚焦活动会话时
// 读取，见 useAttachRun 的双通道发现）；create_time 暂无 UI 消费点。
export type SessionDetail =
  paths['/api/v1/sessions/{session_id}']['get']['responses']['200']['content']['application/json'];
// GET .../context-usage：最近已持久化 turn 的最后一轮 provider 观测（api 分区）。
// available:false 时不带数值；输入空间占比必须使用 input_budget_tokens 而非硬窗口。
export type SessionContextUsageResponse =
  paths['/api/v1/sessions/{session_id}/context-usage']['get']['responses']['200']['content']['application/json'];
export type SessionContextUsageSnapshot = components['schemas']['SessionContextUsageSnapshot'];
// turn 取消响应（cancel 端点）：{run_id, status}。status 枚举见 openapi——
// cancelling（已接受）/ queued（与 pump 竞争，重试）/ running，及幂等取消已终局
// run 时的终态（done/error/cancelled/interrupted）。adapt-session-message-queue：
// 撤回等待项必须观察该返回值（cancelled 才算撤回成功），不能沿用吞结果的包装。
export type TurnStatusResponse =
  paths['/api/v1/sessions/{session_id}/turns/{run_id}/cancel']['post']['responses']['200']['content']['application/json'];
// GET /api/v1/sessions/{session_id}/queue：会话 FIFO 等待列表（session-message-queue，
// queue GET 走 api 分区即 API base——与 POST/attach/cancel 的 agent 分区不同）。
// run_id 兼作等待期的撤回目标与开始执行后的 attach id；content 为发送原文（含
// additional_context 序列化块，展示侧解析）；model 是已解析目录名。读取失败后端
// 降级为空 200——空快照不构成任何终局证明。
export type SessionQueueResponse =
  paths['/api/v1/sessions/{session_id}/queue']['get']['responses']['200']['content']['application/json'];
export type SessionQueueEntry = NonNullable<SessionQueueResponse['queue']>[number];
// GET /api/v1/models(api 分区):可选模型目录与缺省名。无目录部署时后端合成单条
// legacy 条目,此时发送侧显式传 model/reasoning_effort 会 400(per-request-model)。
export type ModelsResponse = paths['/api/v1/models']['get']['responses']['200']['content']['application/json'];
export type ModelEntry = NonNullable<ModelsResponse['models']>[number];
// /api/v1/me/llm-token：当前用户的模型网关 Token 状态与写入请求。GET/PUT/DELETE
// 都不回显明文，PUT 成功只返回不可逆掩码。
export type LLMTokenStatus =
  paths['/api/v1/me/llm-token']['get']['responses']['200']['content']['application/json'];
export type LLMTokenPutRequest =
  paths['/api/v1/me/llm-token']['put']['requestBody']['content']['application/json'];
// 定时任务管理属于 api 分区（add-scheduled-task-management）：CRUD 与 occurrence
// 历史都使用 apiGet/apiPost/apiPatch/apiDelete，不走 Agent 流式 base。
export type ScheduleRule = components['schemas']['ScheduleRule'];
export type ScheduledSessionPolicy = components['schemas']['ScheduledSessionPolicy'];
export type ScheduledTask = components['schemas']['ScheduledTask'];
export type ScheduledTaskCreate =
  paths['/api/v1/scheduled-tasks']['post']['requestBody']['content']['application/json'];
export type ScheduledTaskPatch =
  paths['/api/v1/scheduled-tasks/{task_id}']['patch']['requestBody']['content']['application/json'];
export type ScheduledTaskListResponse =
  paths['/api/v1/scheduled-tasks']['get']['responses']['200']['content']['application/json'];
export type ScheduledTaskRun = components['schemas']['ScheduledTaskRun'];
export type ScheduledTaskRunListResponse =
  paths['/api/v1/scheduled-tasks/{task_id}/runs']['get']['responses']['200']['content']['application/json'];
// 任务资源（.cron 草稿与已发布版本）：GET 元数据 + 幂等发布，均走 api 分区。
export type ScheduledResourceGetResponse =
  paths['/api/v1/scheduled-tasks/{task_id}/resources']['get']['responses']['200']['content']['application/json'];
export type ScheduledResourceVersion = components['schemas']['ScheduledResourceVersion'];
export type ScheduledResourcePublishResponse =
  paths['/api/v1/scheduled-tasks/{task_id}/resources/publish']['post']['responses']['200']['content']['application/json'];
// 任务执行会话（1.3.0 起与普通会话列表彻底分离）的历史读：契约明说与普通会话
// 历史“同 cursor/order/subagent_content 契约”，含同样的 event_type 缺 'artifact'
// 缺口，直接复用已放宽的响应形状。
export type ScheduledSessionMessagesResponse = SessionMessagesResponse;
// 发送请求的思考等级参数类型(与契约枚举一致;UI 提供全集,见 model-selector)。
export type ReasoningEffort = NonNullable<SendMessageRequest['reasoning_effort']>;
// 当轮产物格式偏好：自动模式（auto/空串）在发送时省略，具体值使用契约 canonical 枚举。
export type TurnOutputFormat = NonNullable<SendMessageRequest['output_format']>;
export type CreateSessionResponse = paths['/api/v1/sessions']['post']['responses']['200']['content']['application/json'];
// turn-artifacts：后端在 Message.event_type 枚举中漏了 'artifact'（持久化的产物事件行），
// 本地放宽为 string，待后端补齐契约后可还原为生成类型。放宽落在 Response 层级，
// 行类型（Message）与缓存写回（乐观消息）同口径。
type RawSessionMessagesResponse =
  paths['/api/v1/sessions/{session_id}/messages']['get']['responses']['200']['content']['application/json'];
export type SessionMessagesResponse = Omit<RawSessionMessagesResponse, 'messages'> & {
  messages?: (Omit<NonNullable<RawSessionMessagesResponse['messages']>[number], 'event_type'> & {
    event_type: string;
  })[];
};
export type SendMessageRequest =
  paths['/api/v1/sessions/{session_id}/messages']['post']['requestBody']['content']['application/json'];
export type FileListResponse = paths['/api/v1/workspace/files']['get']['responses']['200']['content']['application/json'];
export type UploadResponse = paths['/api/v1/workspace/upload']['post']['responses']['200']['content']['application/json'];
export type FileContentResponse =
  paths['/api/v1/workspace/files/{path}/content']['get']['responses']['200']['content']['application/json'];
// PUT .../files/{path}/content：整文件原子写（create-or-replace，对称于 GET /content）。
export type WriteContentRequest =
  paths['/api/v1/workspace/files/{path}/content']['put']['requestBody']['content']['application/json'];
export type FileContentWriteResponse =
  paths['/api/v1/workspace/files/{path}/content']['put']['responses']['200']['content']['application/json'];
export type Message = NonNullable<SessionMessagesResponse['messages']>[number];
// add-image-attachments：用户消息行内嵌的图片附件引用与上传响应（id 为
// content 端点键；filename/mime 为展示元数据，不可变）。
export type AttachmentRef = components['schemas']['AttachmentRef'];
export type AttachmentUploadResponse = components['schemas']['AttachmentUploadResponse'];
// turn 产物（artifact 事件 content 的 JSON 形状 / done.meta.artifacts 元素）。
export type ArtifactInfo = components['schemas']['ArtifactInfo'];
// GET .../subagents/:agent_instance_id/runs：同一动态子 Agent 实例的终态 run 元数据。
// 刻意不含 transcript，供前端展开实例时懒加载列表，再按 run 取详情。
export type SubAgentRunListResponse =
  paths['/api/v1/sessions/{session_id}/subagents/{agent_instance_id}/runs']['get']['responses']['200']['content']['application/json'];
export type SubAgentRunSummary = NonNullable<SubAgentRunListResponse['runs']>[number];
// GET .../runs/:run_id：单个 run 的安全 transcript DTO（只含本次 delta，不拼接前驱）。
export type SubAgentRunDetail =
  paths['/api/v1/sessions/{session_id}/subagents/{agent_instance_id}/runs/{run_id}']['get']['responses']['200']['content']['application/json'];
export type SubAgentTranscriptItem = NonNullable<SubAgentRunDetail['transcript']>[number];
// plan_updated.content 解码后的语义计划快照（SSE 与持久化行共用）。
export type PlanSnapshot = components['schemas']['SSEPlanSnapshot'];
export type FileEntry = NonNullable<FileListResponse['files']>[number];
export type UpdateTitleRequest =
  paths['/api/v1/sessions/{session_id}']['patch']['requestBody']['content']['application/json'];
export type UpdateTitleResponse =
  paths['/api/v1/sessions/{session_id}']['patch']['responses']['200']['content']['application/json'];
export type RenameRequest =
  paths['/api/v1/workspace/files/{path}']['put']['requestBody']['content']['application/json'];
export type RenameResponse =
  paths['/api/v1/workspace/files/{path}']['put']['responses']['200']['content']['application/json'];
// POST .../files/{path}：严格新建空文件或空目录（leaf-strict + 自动建父目录）。
export type CreateNodeRequest =
  paths['/api/v1/workspace/files/{path}']['post']['requestBody']['content']['application/json'];
export type CreateNodeResponse =
  paths['/api/v1/workspace/files/{path}']['post']['responses']['200']['content']['application/json'];
// GET /api/v1/workspace/search：按名字子串递归搜索工作区条目（workspace-search）。
// pattern 是字面子串（正则元字符由后端转义，ignore_case 该端点默认 true）；结果按
// 路径字典序分页，total 在命中收集上限时是下界，truncated 表示窗口外还有匹配。
export type WorkspaceSearchResponse =
  paths['/api/v1/workspace/search']['get']['responses']['200']['content']['application/json'];
export type WorkspaceSearchEntry = NonNullable<WorkspaceSearchResponse['entries']>[number];
export type MCPToolsResponse =
  paths['/api/v1/mcp/tools']['get']['responses']['200']['content']['application/json'];
export type MCPTool = NonNullable<MCPToolsResponse['tools']>[number];
export type SkillsResponse = paths['/api/v1/skills']['get']['responses']['200']['content']['application/json'];
export type SkillEntry = NonNullable<SkillsResponse['skills']>[number];

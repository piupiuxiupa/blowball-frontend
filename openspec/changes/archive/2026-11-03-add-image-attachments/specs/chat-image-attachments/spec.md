## ADDED Requirements

### Requirement: 图片选题与预览
输入区 SHALL 提供图片选择入口，仅接受 png/jpeg/webp/gif 四类；单张超过 8MiB 时 SHALL 在选中时即拒绝并提示，不得进入待发送列表；每条消息最多 4 张，满额后选图入口 SHALL 禁用。已选图片 SHALL 以本地预览呈现在输入区且可逐张移除；选题阶段 SHALL NOT 发起任何网络请求。用户在输入框粘贴剪贴板图片时，该图片 SHALL 经与选图入口完全相同的管线（类型、数量、大小、去重、本地预览）进入待发送列表；不包含图片的粘贴 SHALL 保持浏览器默认行为不变。

#### Scenario: 选中图片本地预览
- **WHEN** 用户经选图入口选中一张合法图片
- **THEN** 输入区出现该图片的本地预览与移除入口，且未发出任何 API 请求

#### Scenario: 超过单张大小上限拒绝
- **WHEN** 用户选中的单张图片大于 8MiB
- **THEN** 系统提示大小超限，该图片不进入待发送列表

#### Scenario: 数量满额禁用入口
- **WHEN** 待发送图片已达 4 张
- **THEN** 选图入口呈禁用态，无法继续添加第 5 张

#### Scenario: 移除待发送图片
- **WHEN** 用户移除一张已选图片
- **THEN** 该图片的预览与本地引用被清除，数量上限名额随之释放

#### Scenario: 粘贴剪贴板图片
- **WHEN** 用户在输入框粘贴一张剪贴板图片（如截图）
- **THEN** 该图片经同一管线进入待发送列表并出现本地预览，未发出任何 API 请求

#### Scenario: 纯文本粘贴不受影响
- **WHEN** 用户在输入框粘贴的内容不含图片文件
- **THEN** 粘贴行为与既有文本粘贴完全一致，不触发图片管线

### Requirement: 发送时上传并携带 attachment_ids
发送带图消息时，系统 SHALL 先确保存在真实会话（草稿则先建会话），再将待发送图片逐张上传至该会话的 attachments 端点，最后以返回的 `attachment_ids` 发起消息请求；消息请求体中的 id 数量 SHALL 不超过 4。任一上传失败时系统 SHALL 中止后续步骤、不发出消息请求，并保留输入文本与全部已选图片；同一会话内此前已上传成功的图片 SHALL 复用既有结果，不重复上传。

#### Scenario: 草稿首条带图消息
- **WHEN** 用户在草稿会话中同时输入文本并选中图片后发送
- **THEN** 系统先创建会话，再将图片上传至该会话，随后携带 `attachment_ids` 发出消息请求

#### Scenario: 上传失败中止并保留现场
- **WHEN** 某张图片上传失败
- **THEN** 系统提示错误且不发出消息请求，输入文本与全部图片保留，失败项可重试

#### Scenario: 重试不重复上传已成功项
- **WHEN** 上次发送中部分图片已上传成功后中止，用户再次发送
- **THEN** 已成功项直接复用缓存 id，仅重新上传此前失败与新增的图片

### Requirement: 消息图片渲染
用户消息携带 `attachments` 时，系统 SHALL 在用户气泡中渲染每张附件的图片缩略图，图片 SHALL 经该会话 attachments content 端点的 query-token URL 加载；消息分组块的内容签名 SHALL 包含附件引用列表，附件变化时 SHALL 触发对应消息块重渲染。乐观用户消息 SHALL 携带与落库行同构的附件引用，发送后即时显示图片。

#### Scenario: 历史消息渲染缩略图
- **WHEN** 消息历史中某条用户消息携带 `attachments`
- **THEN** 该消息气泡内渲染每张附件的图片缩略图，图片请求携带 token 与 inline 参数

#### Scenario: 乐观消息即时显示图片
- **WHEN** 带图消息发出、服务端历史尚未 reconcile
- **THEN** 乐观用户消息已按附件引用渲染图片缩略图

#### Scenario: 附件变化刷新渲染
- **WHEN** 同一消息块的附件引用列表发生变化
- **THEN** 消息块内容签名不同，缩略图按新引用重新渲染

### Requirement: 上传与 vision 错误兜底
系统 SHALL NOT 依据模型目录的 `vision` 字段做事前禁用或拦截；带图消息被后端以 `MODEL_NOT_VISION` 拒绝时，系统 SHALL 显式提示原因，且输入文本、已选图片与上传缓存 SHALL 保持不清空。上传阶段的后端类型（`UNSUPPORTED_IMAGE_TYPE`）与大小（`FILE_TOO_LARGE`）错误 SHALL 逐文件显式提示。

#### Scenario: 非 vision 模型发送被拒
- **WHEN** 当前选择模型不支持 vision 且消息携带 `attachment_ids`，后端返回 400 `MODEL_NOT_VISION`
- **THEN** 系统提示消息被拒原因，输入与图片均保留，用户可切换模型后原样重发

#### Scenario: 后端嗅探类型不符
- **WHEN** 某图片上传被后端以 `UNSUPPORTED_IMAGE_TYPE` 拒绝
- **THEN** 系统提示该文件类型不受支持，发送中止且现场保留

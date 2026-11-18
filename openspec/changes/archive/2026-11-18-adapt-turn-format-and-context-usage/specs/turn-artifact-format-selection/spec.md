## ADDED Requirements

### Requirement: 当轮产物格式选择映射为独立请求参数
聊天输入区 SHALL 提供“自动、HTML、Word、PowerPoint、PDF、Excel、Markdown”格式选择，并 SHALL 把具体选择分别映射为 `html`、`docx`、`pptx`、`pdf`、`xlsx`、`md`。自动选择 SHALL 省略 `output_format`，与显式 `auto` 的服务端语义等价。前端 MUST NOT 发送 `excel`、`markdown`、`ppt` 或 `powerpoint` 别名，MUST NOT 把格式指令拼入用户 `content`、附加上下文或乐观消息。每次提交 SHALL 使用点击发送时捕获的格式快照，后续选择变化不得改写已提交请求。

#### Scenario: 自动模式保持旧请求语义
- **WHEN** 用户选择“自动”并发送消息
- **THEN** 请求体省略 `output_format`
- **AND** 正文、图片、模型和思考等级沿用既有发送逻辑

#### Scenario: 具体格式使用 canonical 值
- **WHEN** 用户分别选择 HTML、Word、PowerPoint、PDF、Excel 或 Markdown 并提交
- **THEN** 对应请求分别携带 `output_format:"html"`、`"docx"`、`"pptx"`、`"pdf"`、`"xlsx"` 或 `"md"`
- **AND** 请求不携带其他格式别名

#### Scenario: 提交后继续修改下一条消息的格式
- **WHEN** 用户以 `docx` 提交一条消息，在等待接受期间把下一条消息的格式改为 `pdf`
- **THEN** 已提交请求仍只携带 `docx`
- **AND** 输入区的新选择保持为 `pdf`

### Requirement: 格式选择按被接受的提交一次性消费
具体格式选择 SHALL 只作用于一次被服务端接受的提交；立即执行或收到 queued 接受后 SHALL 将仍属于该提交的选择恢复为自动。复位 SHALL 以提交捕获的选择快照身份为条件，旧请求的迟到接受 MUST NOT 清除其他会话或后续草稿的新选择。建会话、图片上传或消息请求失败时 SHALL 保留选择，不使用无条件成功前清空再恢复的方式。

#### Scenario: 立即执行被接受后恢复自动
- **WHEN** 用户以 `html` 提交且服务端开始立即执行
- **THEN** 本条请求保留 `html` 快照
- **AND** 若用户尚未作出新选择，输入区恢复为自动

#### Scenario: 排队接受同样消费当轮选择
- **WHEN** 当前 run 仍执行时，以 `xlsx` 提交的消息收到 queued 事件
- **THEN** 该 queued 消息的请求快照保留 `xlsx`
- **AND** 输入区仅在选择未被后续修订时恢复自动

#### Scenario: 请求被拒绝时保留格式
- **WHEN** 消息因 `INVALID_OUTPUT_FORMAT`、`QUEUE_FULL`、网络错误或其他准入失败未被接受
- **THEN** 输入区保留正文、附件和本次格式选择
- **AND** `INVALID_OUTPUT_FORMAT` 沿用现有非弹窗消息拒绝提示，不自动重复 POST

#### Scenario: 旧请求接受不清除另一会话的新选择
- **WHEN** 会话 A 的 `docx` 提交尚未确认，用户切换到会话 B 并选择 `pdf`，随后 A 才返回接受
- **THEN** A 只消费自己的 `docx` 提交快照
- **AND** B 的 `pdf` 选择保持不变

### Requirement: 格式控件表达条件性偏好而非生成保证
格式选择器 SHALL 说明具体选择只在本轮既有产物生成条件成立时约束主要最终产物，MUST NOT 将其表述为“每次回复都生成文件”或确定性的格式转换保证。普通问答、澄清、闲聊和简单计算 SHALL 继续由既有 Agent 行为决定是否直接文本回复，前端不得自行创建产物占位或成功提示。

#### Scenario: 选择 PDF 后发送普通问答
- **WHEN** 用户选择 PDF 并输入一个不需要文档产物的简单问题
- **THEN** 请求仍携带当轮 `pdf` 偏好
- **AND** 控件说明该偏好只在需要产物时生效，前端不伪造文件产物或生成成功状态

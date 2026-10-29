# Prompt Enhance（提示词增强）

## 状态

需求已确认，待实现。本文替换上游遗留的实现说明，保留上游设计作为对照。

## 上游实现（已删除，仅作对照）

开源同步时 `prompt/enhance` 协议整簇（方法、schema、两侧实现）被连根删除，见
`packages/shared/src/zcode-protocol/index.ts:27`。残留物只有文案 `chat.promptEnhance.*`
（`packages/ui/src/i18n/locales/zh-CN.ts:5337`）与轨迹来源映射 `prompt_enhance` →「提示优化」
（`packages/ui/src/ModelTrajectoryPaneParts.tsx:145`）。

上游的做法（据旧版本文档）：

- UI 收集草稿和最近对话上下文，增强结果回填 composer；
- 请求下沉到 host 侧 `modelProviderService.enhancePrompt()`，按 providerId 重新读取 provider 配置直连；
- 按 provider 选择 API 协议（claude→Anthropic、codex/opencode→Responses、glm→OpenAI Chat、gemini→Gemini），首选失败再降级；
- 只支持自定义模型供应商，原生模型没有可复用的直连鉴权配置。

`modelProviderService.enhancePrompt` 与对应接口在当前代码中已不存在，确认需要重建。

## 本版设计差异

| 维度 | 上游 | 本版 | 原因 |
| --- | --- | --- | --- |
| 执行位置 | host 直连 provider HTTP | CLI `workspace/generateText` | 复用现成鉴权、路由、usage 与轨迹；不新增协议方法 |
| 模型范围 | 仅自定义供应商 | 任意可选模型（内置 + 自定义） | 内置模型用户也需要这个能力 |
| 上下文 | 带最近对话上下文 | 只发草稿 | 隔离主任务上下文；不占用 context meter，不产生串味 |
| 失败降级 | 多协议自动重试 | 不实现协议降级 | 由 CLI 的 provider 路由负责，UI 不重复造 |

## 已确认的产品决策

| 决策点 | 结论 |
| --- | --- |
| 入口位置 | 输入框底部发送按钮左侧 |
| 端覆盖 | 仅桌面端（Web、手机远控不显示） |
| 总开关 | 默认关闭；关闭时发送按钮左侧完全不渲染图标，也不需要任何配置 |
| 设置入口 | 「模型设置」页左侧导航，「提示词增强」，位于自定义供应商分组之前 |
| 模型来源 | 只用设置里指定的增强模型，不跟随当前对话模型 |
| 推理档位 | 必须由用户显式选择，不提供默认值；未选择时功能不可用 |
| Token 预算 | 不配置最大输出 token，根据所选模型的配置规格自适应生效 |
| 结果落地 | 直接替换草稿文本，不做预览确认 |
| 返回方式 | 一次性返回（现有请求/响应通道） |
| 还原原稿 | 不提供；不承诺编辑器 Cmd+Z 行为 |

## 交互规则

### 状态机

| 状态 | 进入条件 | 表现 |
| --- | --- | --- |
| 不可见 | 功能未开启，或非桌面端 | 不渲染 |
| 禁用（空输入） | 草稿文本为空 | 置灰，tooltip「请先输入需要增强的提示词」 |
| 禁用（未配置） | 未配置增强模型、未选择推理档位，或配置的模型当前不可用 | 置灰，tooltip 提示到设置中补全 |
| 就绪 | 有文本且模型可用 | 可点击 |
| 增强中 | 请求在途 | 图标变 Spinner，tooltip「再次点击可取消」 |
| 失败 | 请求报错/超时 | 保留原文，展示 `chat.promptEnhance.error`，有明细时用 `errorWithDetail` |

### 规则

1. 增强只处理纯文本草稿。草稿含附件或斜杠命令时按钮禁用，避免整段替换破坏结构化内容；
   mention 依赖编辑器内部节点，v1 不做拦截（已知限制，后续接入需从 Lexical 状态取值）。
2. 同一输入框同时只允许一个在途请求。增强中再次点击 = 取消（`AbortController` → `workspace/cancelGenerateText`），取消后草稿保持原文。
3. 发送、切换会话、切换工作区时取消在途请求，迟到结果直接丢弃，不得写入新 scope 的草稿。
4. 成功后就地替换草稿文本，光标移到末尾；只写 `text`，不触碰 `editorStateJson`、`mention`。
5. 增强不产生消息、不进入会话上下文、不影响输入栏 context meter（服务侧按 `querySource` 排除，
   见 `packages/services/src/zcode-agent/zcodeTaskServiceAdapter.ts:5681`）。
6. 增强记录进入模型轨迹，来源显示「提示优化」，usage 正常计入统计。

## 配置

### 设置字段

`packages/shared/src/validationAppSettings.ts` 新增三个字段：

```ts
promptEnhanceEnabled: z.boolean().default(false)
promptEnhanceModel: modelSelectionSchema.optional()
promptEnhanceMaxOutputTokens: z.number().int().positive().default(5000)
```

### 设置入口

入口在「模型设置」页左侧导航中新增一项**「提示词增强」**，位置在预置供应商组之后、自定义供应商组之前
（即截图中 Start Plan 与「自定义供应商」分组之间）。导航项类型在
`packages/ui/src/settings/model-provider-section/constants.ts` 中新增，渲染与选中态在
`Navigation.tsx` / `useModelProviderNavigation.ts` 中接入；右侧详情区为新的「提示词增强」面板。

面板内容：

1. **开关**：默认关闭。关闭时其余配置项隐藏/不需要填写。
2. **模型**：列表来自已经配置好的模型（含预置与自定义供应商），复用
   `packages/ui/src/lib/modelSelectionGroups.ts` 的 `buildRegistryModelSelectGroups`（定时任务设置已在用同一构造）
   和 `packages/ui/src/ModelConfigSelect.tsx` 渲染。
3. **推理档位**：复用 `packages/ui/src/settings/SubagentReasoningField.tsx`（内部是 `ThoughtLevelCycleControl`），
   取值来自所选模型的 `optionSpecs.reasoningLevel.values`。**不预填档位**，用户必须自己选一次；
   模型本身不提供推理档位时该项不显示，也不阻塞保存。
4. **保存机制**：面板采用本地草稿 + 显式保存按钮交互，修改后需点击「保存」按钮才写入设置。
   开启开关后，模型与推理档位（模型支持时）变为必填：保存时校验，缺项时保存按钮禁用并高亮缺项。
   未保存时提示「有未保存的更改」，保存成功弹出 toast 提示。持久化的是完整 `ModelSelection`。只在桌面设置页展示。

### 解析规则

| 情况 | 行为 |
| --- | --- |
| 功能关闭（默认） | 输入框不渲染图标；其余配置项不参与校验 |
| 已开启、模型可用且推理档位已选 | 渲染图标，可点击 |
| 已开启但模型未配置 / 推理档位未选 | 渲染禁用图标，tooltip 提示到设置补全 |
| 已开启但配置的模型被删除 / 套餐不可用 | 渲染禁用图标，tooltip 提示重新配置 |

不提供「回退到当前对话模型」的隐式行为，避免用户不清楚实际消耗的是哪个模型。

## 执行链路

```text
ComposerPromptEnhanceButton（仅桌面）
  → usePromptEnhance（状态机 + 取消 + 错误映射）
  → zcodeAgentService.generateWorkspaceText({
        workspacePath, workspaceIdentity,
        selection: 设置中的增强模型（含推理档位）,
        prompt: buildPrompt(草稿),
        querySource: "prompt_enhance",
        signal, requestTimeoutMs
     })
  → CLI workspace/generateText（独立请求，内部走 streamText 流式聚合，不读会话历史）
  → 返回 text → applyEnhancedText(text)（写入 Lexical 并聚焦）
```

### 提示词

- system：明确「这是改写任务，不执行、不回答用户请求；保留原意与关键约束；只输出改写后的提示词」。
- user：草稿原文。
- 直接返回纯文本，不要求 JSON，避免解析失败引入新的失败态。

### 执行参数

- `selection` 直接使用设置中的完整 `ModelSelection`（含用户显式选择的 `options.reasoningLevel`），CLI 侧不做降档；
- `maxOutputTokens` 取设置值（默认 5000），由调用方显式传入 `workspaceGenerateText`；
- 超时由调用方传入 `requestTimeoutMs`，取消走 `AbortSignal`。

## 改动清单

| 文件 | 改动 |
| --- | --- |
| `packages/ui/src/v4/ConversationComposer.tsx` | `submitControlNode` 发送按钮左侧插入按钮，新增 `isDesktop` prop |
| `packages/ui/src/v4/ComposerPromptEnhanceButton.tsx`（新） | 按钮、tooltip、状态渲染 |
| `packages/ui/src/v4/SessionPane.tsx` | 向 composer 透传 `isDesktop` |
| `packages/ui/src/hooks/usePromptEnhance.ts`（新） | 设置读取、模型可用性判断、请求组装、取消、错误提示 |
| `packages/ui/src/settings/model-provider-section/constants.ts` | 新增导航项类型 `promptEnhance` 与固定 key |
| `packages/ui/src/settings/model-provider-section/useModelProviderNavigation.ts` | 在预置供应商组末尾追加导航项（视觉上位于自定义供应商之前） |
| `packages/ui/src/settings/model-provider-section/utils.tsx` | 该导航项使用 Sparkles 图标 |
| `packages/ui/src/settings/model-provider-section/Detail.tsx` | 命中该导航项时渲染独立面板 |
| `packages/ui/src/settings/PromptEnhanceSettingsPanel.tsx`（新） | 开关 + 模型 + 推理档位 + 本地草稿与显式保存按钮 |
| `packages/shared/src/validationAppSettings.ts` | 新增 `promptEnhanceEnabled` / `promptEnhanceModel` / `promptEnhanceMaxOutputTokens`（含 patch schema） |
| `packages/shared/src/protocol.ts` | `AppSettings` 类型补三个字段 |
| `packages/shared/src/prompt-enhance.ts`（新） | system prompt、输入截断与 prompt 构造函数 |
| `packages/shared/src/test-ids.ts` | 新增 `TID_V4_COMPOSER_PROMPT_ENHANCE` |
| `packages/ui/src/i18n/locales/{zh-CN,en-US}.ts` | 复用 `chat.promptEnhance.*`；补 `notConfigured` / `structuredDraft` 与设置面板文案 |
| `packages/shared/test/promptEnhance.test.ts`（新） | prompt 构造与截断 |
| `packages/ui/test/promptEnhanceModelSelection.test.ts`（新） | 模型/档位可用性判断 |
| `architecture-policy.yaml` | 为四个新增文件登记 `unmanaged-new-file` 例外（保持现有分层，不接管整包） |

## 验收

### 单元 / 组件测试

1. prompt 构造函数：保留原意、纯文本输出、超长草稿截断规则。
2. 开关：关闭时图标不渲染且不做配置校验；开启时模型/档位/上限必填。
3. 模型解析：已配置 / 未配置 / 配置失效三种分支。
4. 推理档位：未选择时视为未配置；选择后按该档位执行，不降档。
5. 输出上限：未设置时按 5000 执行；自定义值原样透传；超过所选模型上限时收敛到模型上限。
6. 按钮状态机：空输入、就绪、增强中、取消、失败、成功替换。
7. 取消与迟到结果：取消后结果不写入草稿；切换会话后旧结果不落到新 scope。

### E2E（`packages/desktop/test/e2e/`）

1. 关闭开关 → 输入框不出现增强图标。
2. 开启并配置模型/档位/上限 → 输入文本 → 点击按钮 → 草稿被替换。
3. 增强中再次点击 → 请求取消，草稿不变。
4. 已开启但模型被移除 → 图标禁用且提示可读。
5. Web / 手机远控视图下按钮不渲染。

## 非目标

- 不做流式输出（需新增增量协议通道，另行排期）。
- 不提供还原原稿入口。
- 不做预览确认、不做多轮迭代增强。
- 不在 Web、手机远控提供入口。
- 不新增 `prompt/enhance` 协议方法，复用 `workspace/generateText`。
- 不携带最近对话上下文（与上游差异，见上文对照表）。

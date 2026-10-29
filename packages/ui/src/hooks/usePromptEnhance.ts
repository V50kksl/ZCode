import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROMPT_ENHANCE_SYSTEM_PROMPT,
  buildPromptEnhanceUserPrompt,
  createUuid,
} from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/services";
import { toast } from "@/components/ui/toast.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";

const PROMPT_ENHANCE_QUERY_SOURCE = "prompt_enhance";
/** thinking 模型可能超过协议默认 RPC 超时；增强是前台操作，给足单次预算。 */
const PROMPT_ENHANCE_REQUEST_TIMEOUT_MS = 120_000;

export interface PromptEnhanceController {
  /** 功能是否开启；关闭时调用方不应渲染入口。 */
  visible: boolean;
  /** 当前是否可点击（空输入、配置不完整时为 false）。 */
  disabled: boolean;
  disabledReason?: string;
  pending: boolean;
  /** 待机时发起增强，增强中再次调用表示取消。 */
  toggle(): void;
}

export interface PromptEnhanceModelCatalogEntry {
  providerId: string;
  modelId: string;
  reasoningLevels: readonly string[];
}

export type PromptEnhanceModelIssue = "not-configured" | "reasoning-required" | null;

/**
 * 判断设置中的增强模型是否可用于发起增强。
 *
 * `models` 为 null 表示模型目录尚未就绪：此时无法校验，先放行，
 * 让真正不可用的模型以请求错误返回，避免首屏加载期按钮闪烁。
 */
export function resolvePromptEnhanceModelIssue(params: {
  selection:
    | { providerId: string; modelId: string; options?: { reasoningLevel?: string } }
    | undefined;
  models: readonly PromptEnhanceModelCatalogEntry[] | null;
}): PromptEnhanceModelIssue {
  const { selection, models } = params;
  if (!selection) return "not-configured";
  if (!models) return null;
  const model = models.find(
    (candidate) =>
      candidate.providerId === selection.providerId && candidate.modelId === selection.modelId,
  );
  if (!model) return "not-configured";
  // 推理档位不预填：模型支持档位时必须由用户显式选择。
  if (model.reasoningLevels.length > 0 && !selection.options?.reasoningLevel?.trim()) {
    return "reasoning-required";
  }
  return null;
}

/**
 * 输入框的提示词增强控制器。
 *
 * 模型与输出上限来自设置；调用走 workspace/generateText 的独立 sidecar 请求，
 * 不携带会话历史，也不写入会话上下文。
 */
export function usePromptEnhance(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  modelSelectionView?: ModelSelectionView | null;
  currentText: string;
  applyText: (text: string) => void;
  /** 草稿含附件或斜杠命令时禁止增强：整段替换会破坏结构化内容。 */
  blocked?: boolean;
}): PromptEnhanceController {
  const {
    workspacePath,
    workspaceIdentity,
    modelSelectionView,
    currentText,
    applyText,
    blocked = false,
  } = params;
  const { intl } = useZCodeIntl();
  const { zcodeAgentService } = useServices();
  const { settings } = useSettings();
  const [pending, setPending] = useState(false);
  // 取消标识只在本 hook 内流转：renderer 跨进程无法传 AbortSignal，取消靠 operationId 通知 CLI。
  const operationIdRef = useRef<string | null>(null);
  const requestSequenceRef = useRef(0);
  const currentTextRef = useRef(currentText);
  currentTextRef.current = currentText;

  useEffect(
    () => () => {
      const operationId = operationIdRef.current;
      operationIdRef.current = null;
      requestSequenceRef.current += 1;
      if (operationId) {
        void zcodeAgentService.cancelGenerateWorkspaceText({
          operationId,
          workspacePath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
        });
      }
    },
    [workspaceIdentity, workspacePath, zcodeAgentService],
  );

  const enabled = settings?.promptEnhanceEnabled === true;
  const storedSelection = settings?.promptEnhanceModel;

  const modelIssue = useMemo(() => {
    const models = modelSelectionView
      ? modelSelectionView.providers.flatMap((provider) =>
          provider.models.map((model) => ({
            providerId: provider.providerId,
            modelId: model.modelId,
            reasoningLevels: model.config.optionSpecs.reasoningLevel?.values ?? [],
          })),
        )
      : null;
    return resolvePromptEnhanceModelIssue({ selection: storedSelection, models });
  }, [modelSelectionView, storedSelection]);

  const selectionIssue = enabled ? modelIssue : ("disabled" as const);

  const hasText = currentText.trim().length > 0;

  const disabledReason = useMemo(() => {
    if (blocked) {
      return intl.formatMessage({ id: "chat.promptEnhance.structuredDraft" });
    }
    if (selectionIssue === "not-configured" || selectionIssue === "reasoning-required") {
      return intl.formatMessage({ id: "chat.promptEnhance.notConfigured" });
    }
    if (!hasText) {
      return intl.formatMessage({ id: "chat.promptEnhance.empty" });
    }
    return undefined;
  }, [blocked, hasText, intl, selectionIssue]);

  const run = useCallback(async () => {
    if (!storedSelection) return;
    const draft = currentTextRef.current.trim();
    if (!draft) return;

    // renderer 经服务代理调用时 AbortSignal 会被结构化克隆破坏，取消改用 operationId。
    const operationId = createUuid();
    operationIdRef.current = operationId;
    const sequence = ++requestSequenceRef.current;
    setPending(true);
    try {
      const reasoningLevel = storedSelection.options?.reasoningLevel?.trim();
      const result = await zcodeAgentService.generateWorkspaceText({
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        selection: {
          providerId: storedSelection.providerId,
          modelId: storedSelection.modelId,
          ...(reasoningLevel ? { options: { reasoningLevel } } : {}),
        },
        messages: [
          { role: "system", content: PROMPT_ENHANCE_SYSTEM_PROMPT },
          { role: "user", content: buildPromptEnhanceUserPrompt(draft) },
        ],
        querySource: PROMPT_ENHANCE_QUERY_SOURCE,
        operationId,
        requestTimeoutMs: PROMPT_ENHANCE_REQUEST_TIMEOUT_MS,
      });

      // 已取消或已发起新请求：迟到结果直接丢弃，不写入草稿。
      if (requestSequenceRef.current !== sequence) {
        return;
      }
      const enhanced = result.text.trim();
      if (!enhanced) {
        toast(intl.formatMessage({ id: "chat.promptEnhance.error" }));
        return;
      }
      // 请求期间用户可能已发送或改写草稿；结果与发起时不一致就丢弃，避免覆盖新内容。
      if (currentTextRef.current.trim() !== draft) {
        return;
      }
      applyText(enhanced);
    } catch (error) {
      if (requestSequenceRef.current !== sequence) {
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      toast(
        detail
          ? intl.formatMessage({ id: "chat.promptEnhance.errorWithDetail" }, { error: detail })
          : intl.formatMessage({ id: "chat.promptEnhance.error" }),
      );
    } finally {
      if (requestSequenceRef.current === sequence) {
        operationIdRef.current = null;
        setPending(false);
      }
    }
  }, [
    applyText,
    intl,
    storedSelection,
    workspaceIdentity,
    workspacePath,
    zcodeAgentService,
  ]);

  const toggle = useCallback(() => {
    if (pending) {
      const operationId = operationIdRef.current;
      operationIdRef.current = null;
      requestSequenceRef.current += 1;
      setPending(false);
      if (operationId) {
        void zcodeAgentService.cancelGenerateWorkspaceText({
          operationId,
          workspacePath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
        });
      }
      toast(intl.formatMessage({ id: "chat.promptEnhance.cancelled" }));
      return;
    }
    if (selectionIssue !== null || !hasText || blocked) {
      return;
    }
    void run();
  }, [
    blocked,
    hasText,
    intl,
    pending,
    run,
    selectionIssue,
    workspaceIdentity,
    workspacePath,
    zcodeAgentService,
  ]);

  return {
    visible: enabled,
    disabled: selectionIssue !== null || !hasText || blocked,
    disabledReason,
    pending,
    toggle,
  };
}

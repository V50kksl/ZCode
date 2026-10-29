import { SparklesIcon } from "lucide-react";
import type { ModelSelectionView } from "@zcode/services";
import { TID_V4_COMPOSER_PROMPT_ENHANCE } from "@zcode/shared/test-ids";
import { Button } from "@/components/ui/button.js";
import { Spinner } from "@/components/ui/spinner.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePromptEnhance } from "@/hooks/usePromptEnhance.js";

/**
 * 发送按钮左侧的提示词增强入口（仅桌面端）。
 *
 * 开关关闭时不渲染；开启但配置不完整或草稿为空时置灰并说明原因。
 */
export function ComposerPromptEnhanceButton({
  workspacePath,
  workspaceIdentity,
  modelSelectionView,
  currentText,
  onApplyText,
  blocked = false,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  modelSelectionView?: ModelSelectionView | null;
  currentText: string;
  onApplyText: (text: string) => void;
  blocked?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const { visible, disabled, disabledReason, pending, toggle } = usePromptEnhance({
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    modelSelectionView,
    currentText,
    applyText: onApplyText,
    blocked,
  });

  if (!visible) {
    return null;
  }

  const title = pending
    ? intl.formatMessage({ id: "chat.promptEnhance.cancel" })
    : intl.formatMessage({ id: "chat.promptEnhance.title" });
  const description = pending
    ? intl.formatMessage({ id: "chat.promptEnhance.cancelDescription" })
    : disabledReason;

  return (
    <ControlHintTooltip title={title} description={description}>
      <Button
        type="button"
        variant="ghost"
        size="icon-md"
        disabled={disabled && !pending}
        onClick={toggle}
        data-testid={TID_V4_COMPOSER_PROMPT_ENHANCE}
        aria-label={title}
      >
        {pending ? <Spinner className="size-4" /> : <SparklesIcon className="size-4" />}
        <span className="sr-only">{title}</span>
      </Button>
    </ControlHintTooltip>
  );
}

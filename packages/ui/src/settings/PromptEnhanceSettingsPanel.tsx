import { useCallback, useEffect, useMemo, useState } from "react";
import { ZCODE_AGENT_PROVIDER, type ModelSelection } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Spinner } from "@/components/ui/spinner.js";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useModelSelectionServiceView } from "@/hooks/useModelSelectionView.js";
import { buildRegistryModelSelectGroups } from "@/lib/modelSelectionGroups.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { resolveModelThoughtOption } from "@/lib/modelThoughtOption.js";
import { logger } from "@/logger.js";
import { ModelConfigSelect } from "@/ModelConfigSelect.js";
import {
  SubagentReasoningField,
  type SubagentReasoningFieldState,
} from "@/settings/SubagentReasoningField.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

const MODEL_ITEM_NEVER_LOCKED = () => false;

interface PromptEnhanceDraft {
  enabled: boolean;
  selection: ModelSelection | undefined;
}

/**
 * 「提示词增强」设置面板。
 *
 * 模型选择复用 Registry 视图：只列出当前账号已配置的模型，不额外维护一份模型目录。
 * 推理档位不预填，开启后必须由用户显式选择（模型本身没有推理档位时整项不出现）。
 * 采用本地草稿 + 显式保存按钮交互：修改后点击保存才持久化到设置。
 */
export function PromptEnhanceSettingsPanel() {
  const { intl } = useZCodeIntl();
  const { modelSelectionService } = useServices();
  const { settings, update } = useSettings();
  const read = useModelSelectionServiceView(modelSelectionService);
  const view = read.state.status === "ready" ? read.state.view : null;

  const baseline = useMemo<PromptEnhanceDraft>(
    () => ({
      enabled: settings?.promptEnhanceEnabled === true,
      selection: settings?.promptEnhanceModel,
    }),
    [settings?.promptEnhanceEnabled, settings?.promptEnhanceModel],
  );

  const [draft, setDraft] = useState<PromptEnhanceDraft>(baseline);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft((current) => {
      const isCurrentDirty =
        current.enabled !== baseline.enabled ||
        current.selection?.providerId !== baseline.selection?.providerId ||
        current.selection?.modelId !== baseline.selection?.modelId ||
        (current.selection?.options?.reasoningLevel?.trim() || "") !==
          (baseline.selection?.options?.reasoningLevel?.trim() || "");
      return isCurrentDirty ? current : baseline;
    });
  }, [baseline]);

  const isDirty = useMemo(() => {
    if (draft.enabled !== baseline.enabled) return true;
    if (!draft.selection && !baseline.selection) return false;
    if (!draft.selection || !baseline.selection) return true;
    if (
      draft.selection.providerId !== baseline.selection.providerId ||
      draft.selection.modelId !== baseline.selection.modelId
    ) {
      return true;
    }
    const draftLevel = draft.selection.options?.reasoningLevel?.trim() || "";
    const baselineLevel = baseline.selection.options?.reasoningLevel?.trim() || "";
    return draftLevel !== baselineLevel;
  }, [baseline, draft]);

  const modelGroups = useMemo(
    () => (view ? buildRegistryModelSelectGroups(ZCODE_AGENT_PROVIDER, view) : []),
    [view],
  );

  const modelValue = draft.selection
    ? encodeCustomModelValue(draft.selection.providerId, draft.selection.modelId)
    : "";
  const reasoningLevel = draft.selection?.options?.reasoningLevel ?? "";

  const thoughtOption = useMemo(() => {
    if (!view || !draft.selection) return null;
    return resolveModelThoughtOption({
      modelSelectionView: view,
      providerId: draft.selection.providerId,
      modelId: draft.selection.modelId,
      currentValue: reasoningLevel,
    });
  }, [view, draft.selection, reasoningLevel]);

  const reasoningState: SubagentReasoningFieldState = !draft.selection
    ? { kind: "not-applicable" }
    : read.state.status === "loading" && !view
      ? { kind: "unknown", status: "loading" }
      : thoughtOption
        ? { kind: "supported", option: thoughtOption }
        : { kind: "not-applicable" };

  const triggerLabel =
    modelGroups.flatMap((group) => group.items).find((item) => item.value === modelValue)?.name ??
    intl.formatMessage({ id: "settings.promptEnhance.model.placeholder" });

  const handleEnabledChange = useCallback((checked: boolean) => {
    setDraft((prev) => ({ ...prev, enabled: checked }));
  }, []);

  const handleModelChange = useCallback((value: string) => {
    const decoded = decodeCustomModelValue(value);
    if (!decoded?.modelName) return;
    const modelId = decoded.modelName;
    // 换模型后旧档位可能不再合法：清空档位，要求用户重新选择。
    setDraft((prev) => ({
      ...prev,
      selection: { providerId: decoded.providerId, modelId },
    }));
  }, []);

  const handleReasoningCommit = useCallback((level: string) => {
    setDraft((prev) => {
      if (!prev.selection || !level) return prev;
      return {
        ...prev,
        selection: {
          ...prev.selection,
          options: { reasoningLevel: level },
        },
      };
    });
  }, []);

  const configIncomplete =
    draft.enabled &&
    (!draft.selection || (thoughtOption !== null && reasoningLevel.trim() === ""));

  const canSave = isDirty && !configIncomplete && !saving && Boolean(settings);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await update({
        promptEnhanceEnabled: draft.enabled,
        promptEnhanceModel: draft.selection,
      });
      toast(intl.formatMessage({ id: "settings.promptEnhance.saved" }));
    } catch (error: unknown) {
      logger.warn("[prompt-enhance] 保存设置失败", error);
      toast(intl.formatMessage({ id: "settings.promptEnhance.saveFailed" }));
    } finally {
      setSaving(false);
    }
  }, [canSave, draft.enabled, draft.selection, intl, update]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="min-w-0">
        <h2 className="text-ui-lg font-semibold text-foreground">
          {intl.formatMessage({ id: "settings.promptEnhance.title" })}
        </h2>
        <p className="mt-1 text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.promptEnhance.description" })}
        </p>
      </div>

      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.promptEnhance.enabled" })}
          description={intl.formatMessage({ id: "settings.promptEnhance.enabledDescription" })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "settings.promptEnhance.enabled" })}
              checked={draft.enabled}
              disabled={!settings}
              onCheckedChange={handleEnabledChange}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.promptEnhance.model" })}
          controlLayout="wide"
          control={
            <div className="flex w-full min-w-0 justify-end">
              <ModelConfigSelect
                modelGroups={modelGroups}
                normalizedValue={modelValue}
                triggerLabel={triggerLabel}
                showManageModelsAction={false}
                lockReasonMessage=""
                isItemLocked={MODEL_ITEM_NEVER_LOCKED}
                onValueChange={handleModelChange}
                contentAlign="end"
                labelVisibilityClassName="inline-flex min-w-0"
                triggerClassName="h-8 w-full max-w-72 min-w-0 justify-between rounded-lg border border-input-border bg-input px-3 py-1.5 text-foreground hover:border-input-border-hover hover:bg-input"
                triggerLabelClassName="inline-flex min-w-0 truncate text-left"
                disabled={!draft.enabled || !view}
              />
            </div>
          }
        />
        {reasoningState.kind === "supported" || reasoningState.kind === "unknown" ? (
          <SettingsRow
            label={intl.formatMessage({ id: "settings.promptEnhance.reasoning" })}
            description={intl.formatMessage({ id: "settings.promptEnhance.reasoningHint" })}
            controlLayout="wide"
            control={
              <div className="flex w-full min-w-0 justify-end">
                <SubagentReasoningField
                  intl={intl}
                  state={reasoningState}
                  disabled={!draft.enabled}
                  labelVisibilityClassName="inline-flex min-w-0"
                  onValueCommit={handleReasoningCommit}
                />
              </div>
            }
          />
        ) : null}
      </SettingsGroupCard>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {configIncomplete ? (
            <p className="text-ui-sm text-destructive">
              {intl.formatMessage({ id: "settings.promptEnhance.incomplete" })}
            </p>
          ) : isDirty ? (
            <p className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "settings.promptEnhance.unsavedChanges" })}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={!canSave}
          onClick={() => void handleSave()}
        >
          {saving ? <Spinner className="size-4" /> : null}
          {intl.formatMessage({ id: "settings.promptEnhance.save" })}
        </Button>
      </div>
    </div>
  );
}

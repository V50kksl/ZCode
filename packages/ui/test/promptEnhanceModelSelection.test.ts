import { describe, expect, it } from "vitest";
import { resolvePromptEnhanceModelIssue } from "@/hooks/usePromptEnhance.js";

const models = [
  { providerId: "zcode", modelId: "glm-4.6", reasoningLevels: ["low", "high"] },
  { providerId: "zcode", modelId: "glm-4.5-air", reasoningLevels: [] },
];

describe("prompt enhance model selection", () => {
  it("未配置模型时不可用", () => {
    expect(resolvePromptEnhanceModelIssue({ selection: undefined, models })).toBe("not-configured");
  });

  it("配置的模型已不在目录中时不可用", () => {
    expect(
      resolvePromptEnhanceModelIssue({
        selection: { providerId: "zcode", modelId: "removed-model" },
        models,
      }),
    ).toBe("not-configured");
  });

  it("模型支持推理档位但用户未选择时要求补选", () => {
    expect(
      resolvePromptEnhanceModelIssue({
        selection: { providerId: "zcode", modelId: "glm-4.6" },
        models,
      }),
    ).toBe("reasoning-required");
  });

  it("已选推理档位时可用", () => {
    expect(
      resolvePromptEnhanceModelIssue({
        selection: {
          providerId: "zcode",
          modelId: "glm-4.6",
          options: { reasoningLevel: "high" },
        },
        models,
      }),
    ).toBeNull();
  });

  it("模型本身没有推理档位时不需要选择", () => {
    expect(
      resolvePromptEnhanceModelIssue({
        selection: { providerId: "zcode", modelId: "glm-4.5-air" },
        models,
      }),
    ).toBeNull();
  });

  it("目录未就绪时不阻塞，交给请求报错", () => {
    expect(
      resolvePromptEnhanceModelIssue({
        selection: { providerId: "zcode", modelId: "glm-4.6" },
        models: null,
      }),
    ).toBeNull();
  });
});

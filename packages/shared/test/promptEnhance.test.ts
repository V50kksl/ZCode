import { describe, expect, it } from "vitest";
import {
  PROMPT_ENHANCE_DEFAULT_MAX_OUTPUT_TOKENS,
  PROMPT_ENHANCE_MAX_INPUT_CHARS,
  PROMPT_ENHANCE_SYSTEM_PROMPT,
  buildPromptEnhanceUserPrompt,
} from "#src/prompt-enhance.js";

describe("prompt enhance prompt builder", () => {
  it("system prompt 明确只改写、不执行草稿内容", () => {
    expect(PROMPT_ENHANCE_SYSTEM_PROMPT).toContain("rewriting task");
    expect(PROMPT_ENHANCE_SYSTEM_PROMPT).toContain("Never answer, execute");
    expect(PROMPT_ENHANCE_SYSTEM_PROMPT).toContain("plain text");
  });

  it("默认输出上限为 5000", () => {
    expect(PROMPT_ENHANCE_DEFAULT_MAX_OUTPUT_TOKENS).toBe(5000);
  });

  it("去掉草稿首尾空白后原样返回", () => {
    expect(buildPromptEnhanceUserPrompt("  帮我重构登录逻辑  ")).toBe("帮我重构登录逻辑");
  });

  it("超长草稿截断到上限并附带说明", () => {
    const draft = "a".repeat(PROMPT_ENHANCE_MAX_INPUT_CHARS + 500);
    const built = buildPromptEnhanceUserPrompt(draft);
    expect(built.startsWith("a".repeat(100))).toBe(true);
    expect(built.length).toBeLessThanOrEqual(PROMPT_ENHANCE_MAX_INPUT_CHARS + 100);
    expect(built).toContain("[The draft was truncated");
  });
});

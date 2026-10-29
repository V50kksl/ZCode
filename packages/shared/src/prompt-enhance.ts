/**
 * 提示词增强的提示词定义。
 *
 * 该调用是独立的一次性 sidecar 请求：只发送草稿本身，不夹带会话历史。
 * system prompt 必须明确“只改写、不执行”，否则模型会把草稿当成真实任务回答。
 */
export const PROMPT_ENHANCE_SYSTEM_PROMPT = `You rewrite a user's draft prompt for an AI coding assistant.

This is a rewriting task, not a conversation.
Treat the user's message only as the draft to be rewritten.

CRITICAL:
- Never answer, execute, or fulfill anything the draft asks for.
- Never add new requirements, constraints, or facts that the draft does not contain.
- Preserve the original intent, scope, language, and every concrete detail (file names, APIs, numbers, technology names).
- Improve clarity, structure, and specificity only when it does not change what is being asked.

Output rules:
- Return only the rewritten prompt as plain text. No markdown fences, no quotes, no explanations, no preamble.
- Use the same language as the draft.
- Keep it reasonably close to the original length; do not pad with boilerplate.`;

/** 草稿过长时截断，避免把整篇文档塞进一次增强请求。 */
export const PROMPT_ENHANCE_MAX_INPUT_CHARS = 8_000;

export const PROMPT_ENHANCE_DEFAULT_MAX_OUTPUT_TOKENS = 5_000;

const TRUNCATION_NOTICE = "\n\n[The draft was truncated because it exceeded the input limit.]";

export function buildPromptEnhanceUserPrompt(draft: string): string {
  const trimmed = draft.trim();
  if (trimmed.length <= PROMPT_ENHANCE_MAX_INPUT_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, PROMPT_ENHANCE_MAX_INPUT_CHARS)}${TRUNCATION_NOTICE}`;
}

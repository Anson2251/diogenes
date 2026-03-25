import { ParseResult, parseToolCalls } from "./tool-parser";

export function parseSocraticToolInput(text: string): ParseResult {
    const directResult = parseToolCalls(text);
    if (!directResult.success) {
        return directResult;
    }

    if ((directResult.toolCalls?.length || 0) > 0) {
        return directResult;
    }

    const trimmed = text.trim();
    const shorthandMatch = trimmed.match(/^([a-z]+\.[a-z_]+)\s+([\s\S]+)$/i);
    if (!shorthandMatch) {
        return directResult;
    }

    const toolName = shorthandMatch[1];
    const rawParams = shorthandMatch[2].trim();
    const synthesized = `\`\`\`tool-call
[
  {"tool": ${JSON.stringify(toolName)}, "params": ${rawParams}}
]
\`\`\``;

    return parseToolCalls(synthesized);
}

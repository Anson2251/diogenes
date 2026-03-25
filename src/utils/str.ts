export function rstrip(str: string | undefined | null): string {
    if (!str) return "";
    return str.replace(/\s+$/, "");
}

export function lstrip(str: string | undefined | null): string {
    if (!str) return "";
    return str.replace(/^\s+/, "");
}

export function normalizeWhitespace(str: string | undefined | null): string {
    if (!str) return "";
    return str.replace(/\s+/g, " ").trim();
}

export function compareLines(a: string | undefined | null, b: string | undefined | null, loose: boolean): boolean {
    if (a === b) return true;
    if (!loose) return false;
    return rstrip(a) === rstrip(b);
}

/**
 * Check if one string contains the other (substring matching).
 * This helps when LLMs provide partial text or truncated lines.
 * @param a First string to compare
 * @param b Second string to compare
 * @param minLength Minimum length for a match to be considered valid (default: 10)
 * @returns true if one string is a substantial substring of the other
 */
export function containsOrContained(a: string | undefined | null, b: string | undefined | null, minLength = 10): boolean {
    if (!a || !b) return false;
    
    // Normalize both strings for comparison
    const normalizedA = normalizeWhitespace(a);
    const normalizedB = normalizeWhitespace(b);
    
    // Skip if either is too short to be meaningful
    if (normalizedA.length < minLength || normalizedB.length < minLength) {
        return false;
    }
    
    // Check if one contains the other
    return normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA);
}

/**
 * Calculate similarity score between two strings (0-1).
 * Uses a simple approach based on common characters and length.
 */
export function similarityScore(a: string | undefined | null, b: string | undefined | null): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    
    const normalizedA = normalizeWhitespace(a);
    const normalizedB = normalizeWhitespace(b);
    
    if (normalizedA === normalizedB) return 0.95;
    
    // Check substring match
    if (normalizedA.includes(normalizedB)) return normalizedB.length / normalizedA.length;
    if (normalizedB.includes(normalizedA)) return normalizedA.length / normalizedB.length;
    
    // Simple character-based similarity
    const shorter = normalizedA.length < normalizedB.length ? normalizedA : normalizedB;
    const longer = normalizedA.length < normalizedB.length ? normalizedB : normalizedA;
    
    let matches = 0;
    for (const char of shorter) {
        if (longer.includes(char)) matches++;
    }
    
    return matches / longer.length;
}

export interface LineDisplayOptions {
    padWidth?: number;
    normalizeCarriageReturn?: boolean;
}

export function formatDisplayLine(
    lineNumber: number,
    line: string | undefined | null,
    options: LineDisplayOptions = {},
): string {
    const { padWidth = 0, normalizeCarriageReturn = true } = options;
    const raw = line ?? "";
    const content = normalizeCarriageReturn ? raw.replace(/\r$/, "") : raw;
    const number = padWidth > 0 ? lineNumber.toString().padStart(padWidth) : lineNumber.toString();
    return `${number} ${content.length > 0 ? "" : "<EMPTY LINE> "}| ${content}`;
}

export function clampLineNumber(line: number, totalLines: number): number {
    if (totalLines <= 0) return 1;
    return Math.max(1, Math.min(line || 1, totalLines));
}

export function formatDisplayWindow(
    lines: string[],
    centerLine: number,
    radius: number,
    options: LineDisplayOptions = {},
): string[] {
    if (lines.length === 0) {
        return ["(empty file)"];
    }

    const clampedCenter = clampLineNumber(centerLine, lines.length);
    const start = Math.max(1, clampedCenter - radius);
    const end = Math.min(lines.length, clampedCenter + radius);
    const output: string[] = [];

    for (let lineNo = start; lineNo <= end; lineNo++) {
        output.push(formatDisplayLine(lineNo, lines[lineNo - 1], options));
    }

    return output;
}

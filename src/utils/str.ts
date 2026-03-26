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

export interface MyersDiffHunk {
    oldStart: number;
    oldEnd: number;
    newStart: number;
    newEnd: number;
}

type MyersDiffOp =
    | { type: "equal"; line: string }
    | { type: "delete"; line: string }
    | { type: "insert"; line: string };

function buildMyersDiffOps(oldLines: string[], newLines: string[]): MyersDiffOp[] {
    const max = oldLines.length + newLines.length;
    const offset = max;
    const trace: number[][] = [];
    let v = new Array(2 * max + 1).fill(0);

    for (let d = 0; d <= max; d++) {
        trace.push([...v]);

        for (let k = -d; k <= d; k += 2) {
            const index = k + offset;
            let x: number;

            if (k === -d || (k !== d && v[index - 1] < v[index + 1])) {
                x = v[index + 1];
            } else {
                x = v[index - 1] + 1;
            }

            let y = x - k;
            while (x < oldLines.length && y < newLines.length && oldLines[x] === newLines[y]) {
                x++;
                y++;
            }

            v[index] = x;
            if (x >= oldLines.length && y >= newLines.length) {
                trace.push([...v]);
                const ops: MyersDiffOp[] = [];
                let backtrackX = oldLines.length;
                let backtrackY = newLines.length;

                for (let depth = trace.length - 1; depth > 0; depth--) {
                    const previous = trace[depth - 1];
                    const currentK = backtrackX - backtrackY;
                    const currentIndex = currentK + offset;
                    let previousK: number;

                    if (
                        currentK === -(depth - 1)
                        || (currentK !== (depth - 1) && previous[currentIndex - 1] < previous[currentIndex + 1])
                    ) {
                        previousK = currentK + 1;
                    } else {
                        previousK = currentK - 1;
                    }

                    const previousX = previous[previousK + offset];
                    const previousY = previousX - previousK;

                    while (backtrackX > previousX && backtrackY > previousY) {
                        ops.push({ type: "equal", line: oldLines[backtrackX - 1] });
                        backtrackX--;
                        backtrackY--;
                    }

                    if (depth === 1) {
                        continue;
                    }

                    if (backtrackX === previousX) {
                        ops.push({ type: "insert", line: newLines[backtrackY - 1] });
                        backtrackY--;
                    } else {
                        ops.push({ type: "delete", line: oldLines[backtrackX - 1] });
                        backtrackX--;
                    }
                }

                while (backtrackX > 0 && backtrackY > 0) {
                    ops.push({ type: "equal", line: oldLines[backtrackX - 1] });
                    backtrackX--;
                    backtrackY--;
                }
                while (backtrackX > 0) {
                    ops.push({ type: "delete", line: oldLines[backtrackX - 1] });
                    backtrackX--;
                }
                while (backtrackY > 0) {
                    ops.push({ type: "insert", line: newLines[backtrackY - 1] });
                    backtrackY--;
                }

                return ops.reverse();
            }
        }
    }

    return [];
}

export function computeMyersLineDiffHunks(oldText: string, newText: string): MyersDiffHunk[] {
    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");
    const ops = buildMyersDiffOps(oldLines, newLines);
    const hunks: MyersDiffHunk[] = [];
    let oldLine = 1;
    let newLine = 1;
    let current: MyersDiffHunk | null = null;

    for (const op of ops) {
        if (op.type === "equal") {
            if (current) {
                hunks.push(current);
                current = null;
            }
            oldLine++;
            newLine++;
            continue;
        }

        if (!current) {
            current = {
                oldStart: oldLine,
                oldEnd: oldLine - 1,
                newStart: newLine,
                newEnd: newLine - 1,
            };
        }

        if (op.type === "delete") {
            current.oldEnd = oldLine;
            oldLine++;
            continue;
        }

        current.newEnd = newLine;
        newLine++;
    }

    if (current) {
        hunks.push(current);
    }

    return hunks;
}

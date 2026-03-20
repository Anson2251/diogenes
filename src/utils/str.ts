export function rstrip(str: string): string {
    return str.replace(/\s+$/, "");
}

export function lstrip(str: string): string {
    return str.replace(/^\s+/, "");
}

export function normalizeWhitespace(str: string): string {
    return str.replace(/\s+/g, " ").trim();
}

export function compareLines(a: string, b: string, loose: boolean): boolean {
    if (a === b) return true;
    if (!loose) return false;
    return rstrip(a) === rstrip(b);
}

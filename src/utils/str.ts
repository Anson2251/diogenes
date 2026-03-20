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

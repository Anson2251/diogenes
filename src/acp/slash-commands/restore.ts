import type { SlashCommandDefinition, SnapshotSummary } from "./types";

function getShortId(snapshotId: string): string {
    const parts = snapshotId.split("-");
    if (parts.length >= 3) {
        return parts.slice(2).join("-").slice(0, 8);
    }
    return snapshotId.slice(0, 8);
}

type FindSnapshotResult =
    | {
          kind: "found";
          snapshot: SnapshotSummary;
          matchType: "exact" | "short-id" | "index" | "label";
      }
    | { kind: "ambiguous"; matches: SnapshotSummary[]; matchType: "short-id" | "label" }
    | { kind: "not-found" };

function findSnapshot(snapshots: SnapshotSummary[], query: string): FindSnapshotResult {
    const trimmedQuery = query.trim().toLowerCase();

    // 1. Try exact match first (case-insensitive)
    const exactMatch = snapshots.find((s) => s.snapshotId.toLowerCase() === trimmedQuery);
    if (exactMatch) {
        return { kind: "found", snapshot: exactMatch, matchType: "exact" };
    }

    // 2. Try index match (1-based)
    const index = Number.parseInt(trimmedQuery, 10);
    if (!Number.isNaN(index) && index >= 1 && index <= snapshots.length) {
        const snapshot = snapshots[index - 1];
        if (snapshot) {
            return { kind: "found", snapshot, matchType: "index" };
        }
    }

    // 3. Try short ID prefix match (case-insensitive)
    const shortIdMatches: SnapshotSummary[] = snapshots.filter((s: SnapshotSummary) =>
        getShortId(s.snapshotId).toLowerCase().startsWith(trimmedQuery),
    );
    if (shortIdMatches.length === 1) {
        const snapshot = shortIdMatches[0];
        if (snapshot) {
            return { kind: "found", snapshot, matchType: "short-id" };
        }
    }
    if (shortIdMatches.length > 1) {
        return { kind: "ambiguous", matches: shortIdMatches, matchType: "short-id" };
    }

    // 4. Try label match (case-insensitive, partial)
    const labelMatches = snapshots.filter((s) => s.label?.toLowerCase().includes(trimmedQuery));
    if (labelMatches.length === 1) {
        const snapshot = labelMatches[0];
        if (snapshot) {
            return { kind: "found", snapshot, matchType: "label" };
        }
    }
    if (labelMatches.length > 1) {
        return { kind: "ambiguous", matches: labelMatches, matchType: "label" };
    }

    return { kind: "not-found" };
}

function formatSnapshotList(snapshots: SnapshotSummary[], limit = 5): string {
    if (snapshots.length === 0) {
        return "No snapshots available. Create one with `/snapshot <label>`.";
    }

    const lines = snapshots.slice(0, limit).map((s: SnapshotSummary, i) => {
        const snapshotId: string = s.snapshotId;
        const shortId = getShortId(snapshotId);
        const label = s.label ? ` "${s.label}"` : "";
        return `${i + 1}. \`${shortId}\`${label}`;
    });

    if (snapshots.length > limit) {
        lines.push(`\n*... and ${snapshots.length - limit} more*`);
    }

    return lines.join("\n");
}

export function createRestoreSlashCommand(): SlashCommandDefinition {
    return {
        command: {
            name: "restore",
            description: "Restore a session snapshot",
            input: {
                hint: "snapshot id, number, or label",
            },
            _meta: {
                diogenes: {
                    kind: "snapshot_restore",
                    invocations: ["/restore"],
                    example: "/restore 1",
                },
            },
        },
        skipAutoBeforePromptSnapshot: true,
        execute: async (context, parsed) =>
            context.runLocalCommand(parsed, async (historyBeforeCommand, userMessage) => {
                const query = parsed.argumentsText?.trim() || "";
                const snapshots = await context.listSnapshots();

                if (!query) {
                    const message = [
                        "**Restore a Snapshot**",
                        "",
                        "Usage: `/restore <query>`",
                        "",
                        "Query can be:",
                        "- **Number**: `/restore 1` (position in list)",
                        "- **Short ID**: `/restore abc123` (first 8 chars)",
                        "- **Label**: `/restore before-edit` (partial match)",
                        "",
                        "**Recent snapshots:**",
                        formatSnapshotList(snapshots),
                    ].join("\n");

                    return context.completeLocalCommand(
                        historyBeforeCommand,
                        userMessage,
                        message,
                        false,
                    );
                }

                const result = findSnapshot(snapshots, query);

                if (result.kind === "not-found") {
                    const errorMsg = [
                        `❌ No snapshot found for "${query}"`,
                        "",
                        "**Available snapshots:**",
                        formatSnapshotList(snapshots),
                    ].join("\n");

                    return context.completeLocalCommand(
                        historyBeforeCommand,
                        userMessage,
                        errorMsg,
                        false,
                    );
                }

                if (result.kind === "ambiguous") {
                    const matchTypeText = result.matchType === "short-id" ? "short ID" : "label";
                    const errorMsg = [
                        `⚠️ **Multiple snapshots match this ${matchTypeText}**`,
                        "",
                        "Please be more specific:",
                        formatSnapshotList(result.matches),
                        "",
                        "💡 **Tip:** Use a longer prefix or the full ID",
                    ].join("\n");

                    return context.completeLocalCommand(
                        historyBeforeCommand,
                        userMessage,
                        errorMsg,
                        false,
                    );
                }

                // Found unique match - at this point result.kind must be "found"
                if (result.kind !== "found") {
                    throw new Error("Unexpected result kind");
                }
                const snapshot: SnapshotSummary = result.snapshot;
                const matchType = result.matchType;
                const snapshotId: string = snapshot.snapshotId;
                const shortId = getShortId(snapshotId);
                const labelText = snapshot.label ? ` "${snapshot.label}"` : "";

                // Restore the snapshot
                const restoreResult = await context.restoreSnapshotWithNotifications(snapshotId);
                const safetyShortId = restoreResult.safetySnapshotId
                    ? getShortId(restoreResult.safetySnapshotId)
                    : null;

                const message = [
                    `✅ **Restored**${labelText}`,
                    "",
                    `**Snapshot:** \`${shortId}\` (${matchType})`,
                    safetyShortId ? `**Safety backup:** \`${safetyShortId}\`` : "",
                    "",
                    "💡 Your previous state was backed up. Use `/restore` again to go back if needed.",
                ]
                    .filter(Boolean)
                    .join("\n");

                return context.completeLocalCommand(
                    historyBeforeCommand,
                    userMessage,
                    message,
                    true,
                );
            }),
    };
}

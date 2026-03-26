#!/usr/bin/env node

const fs = require("fs");

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    const args = process.argv.slice(2);
    const subcommand = args[0];
    const logPath = process.env.FAKE_RESTIC_LOG;
    const delayMs = Number(process.env.FAKE_RESTIC_DELAY_MS || "0");
    const failSubcommand = process.env.FAKE_RESTIC_FAIL_SUBCOMMAND;
    const failCode = Number(process.env.FAKE_RESTIC_FAIL_CODE || "1");
    const malformedSubcommand = process.env.FAKE_RESTIC_MALFORMED_SUBCOMMAND;

    if (logPath) {
        const entry = {
            args,
            env: {
                RESTIC_REPOSITORY: process.env.RESTIC_REPOSITORY,
                RESTIC_PASSWORD: process.env.RESTIC_PASSWORD,
                RESTIC_PASSWORD_FILE: process.env.RESTIC_PASSWORD_FILE,
                RESTIC_PASSWORD_COMMAND: process.env.RESTIC_PASSWORD_COMMAND,
            },
        };
        fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
    }

    if (delayMs > 0) {
        await sleep(delayMs);
    }

    if (subcommand === failSubcommand) {
        process.stderr.write(`forced failure for ${subcommand}`);
        process.exit(failCode);
        return;
    }

    if (subcommand === malformedSubcommand) {
        process.stdout.write("not-json\n");
        return;
    }

    if (subcommand === "init") {
        process.stdout.write("created restic repository test-repo\n");
        return;
    }

    if (subcommand === "backup") {
        process.stdout.write(JSON.stringify({
            message_type: "status",
            files_done: 3,
        }) + "\n");
        process.stdout.write(JSON.stringify({
            message_type: "summary",
            snapshot_id: "abc123def456",
        }) + "\n");
        return;
    }

    if (subcommand === "snapshots") {
        process.stdout.write(JSON.stringify([
            {
                id: "abc123def456",
                short_id: "abc123de",
                time: "2026-03-26T12:00:00.000Z",
                hostname: "test-host",
                paths: ["/workspace"],
                tags: ["before_prompt"],
            },
        ]));
        return;
    }

    if (subcommand === "restore") {
        process.stdout.write("restore complete\n");
        return;
    }

    process.stderr.write(`unknown subcommand: ${subcommand}`);
    process.exit(2);
}

main().catch((error) => {
    process.stderr.write(String(error && error.stack ? error.stack : error));
    process.exit(1);
});

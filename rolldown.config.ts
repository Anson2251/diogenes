const targets = {
    cli: {
        input: "dist/cli.js",
        outputBaseName: "cli",
    },
    acp: {
        input: "dist/acp-cli.js",
        outputBaseName: "acp-server",
    },
} as const;

type TargetName = keyof typeof targets;
type OutputFormat = "cjs" | "esm";

function resolveTarget(name: TargetName): (typeof targets)[TargetName] {
    const target = targets[name];
    if (!target) {
        throw new Error(`Unknown rolldown target: ${name}`);
    }
    return target;
}

function resolveFormat(format: string): OutputFormat {
    if (format !== "cjs" && format !== "esm") {
        throw new Error(`Unsupported rolldown format: ${format}`);
    }
    return format;
}

export function createConfig(targetName: TargetName, formatName: string) {
    const target = resolveTarget(targetName);
    const format = resolveFormat(formatName);
    const extension = format === "esm" ? "mjs" : "cjs";

    return {
        input: target.input,
        platform: "node",
        output: {
            codeSplitting: false,
            file: `bundle/${target.outputBaseName}.${extension}`,
            format,
        },
    };
}

const targetName = process.env.TARGET ?? "cli";
const formatName = process.env.FORMAT || "cjs";

export default createConfig(targetName, formatName);

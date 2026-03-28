import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

import { DEFAULT_LLM_CONFIG, DEFAULT_SECURITY_CONFIG } from "../config/default-prompts";
import {
    ensureDiogenesAppDirsSync,
    findDefaultConfigFileSync,
    resolveDiogenesAppPaths,
} from "./app-paths";

export function ensureDefaultConfigFileSync(): string {
    const appPaths = ensureDiogenesAppDirsSync();
    const existingConfig = findDefaultConfigFileSync();
    if (existingConfig) {
        return existingConfig;
    }

    const configPath = path.join(appPaths.configDir, "config.yaml");
    const defaultConfig = {
        llm: {
            model: DEFAULT_LLM_CONFIG.model,
            baseURL: DEFAULT_LLM_CONFIG.baseURL,
        },
        security: {
            snapshot: {
                enabled: DEFAULT_SECURITY_CONFIG.snapshot.enabled,
                includeDiogenesState: DEFAULT_SECURITY_CONFIG.snapshot.includeDiogenesState,
                autoBeforePrompt: DEFAULT_SECURITY_CONFIG.snapshot.autoBeforePrompt,
            },
        },
    };

    const banner = [
        "# Diogenes default configuration",
        "# Generated automatically on first run.",
        "# Add OPENAI_API_KEY in your shell environment or .env file.",
        "",
    ].join("\n");

    fs.writeFileSync(configPath, `${banner}${yaml.stringify(defaultConfig)}`, "utf8");
    return configPath;
}

export function getManagedDefaultConfigPathSync(): string {
    return path.join(resolveDiogenesAppPaths().configDir, "config.yaml");
}

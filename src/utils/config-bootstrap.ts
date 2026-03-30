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

export function ensureDefaultModelsConfigSync(): string {
    const appPaths = ensureDiogenesAppDirsSync();
    const modelsPath = appPaths.modelsConfigPath;

    if (fs.existsSync(modelsPath)) {
        return modelsPath;
    }

    const defaultModelsConfig = {
        providers: {
            openai: {
                style: "openai",
                baseURL: "https://api.openai.com/v1",
                supportsToolRole: false,
                models: {
                    "gpt-4o": {
                        name: "GPT-4o",
                        description: "Most capable GPT-4 model",
                        contextWindow: 128000,
                    },
                    "gpt-4o-mini": {
                        name: "GPT-4o Mini",
                        description: "Fast and affordable",
                        contextWindow: 128000,
                    },
                    "gpt-4-turbo": {
                        name: "GPT-4 Turbo",
                        description: "Previous generation flagship",
                        contextWindow: 128000,
                    },
                    "gpt-3.5-turbo": {
                        name: "GPT-3.5 Turbo",
                        description: "Fast and economical",
                        contextWindow: 16385,
                    },
                },
            },
            anthropic: {
                style: "anthropic",
                baseURL: "https://api.anthropic.com/v1",
                supportsToolRole: false,
                models: {
                    "claude-sonnet-4-20250514": {
                        name: "Claude Sonnet 4",
                        description: "Latest Claude model",
                        contextWindow: 200000,
                    },
                    "claude-3-5-sonnet-20241022": {
                        name: "Claude 3.5 Sonnet",
                        description: "High performance",
                        contextWindow: 200000,
                    },
                    "claude-3-5-haiku-20241022": {
                        name: "Claude 3.5 Haiku",
                        description: "Fast and efficient",
                        contextWindow: 200000,
                    },
                },
            },
            openrouter: {
                style: "openai",
                baseURL: "https://openrouter.ai/api/v1",
                supportsToolRole: false,
                models: {
                    auto: {
                        name: "Auto",
                        description: "Let OpenRouter choose the best model",
                        contextWindow: 128000,
                    },
                },
            },
        },
        default: "openai/gpt-4o",
    };

    const banner = [
        "# Diogenes models configuration",
        "# Define providers and their models here.",
        "# API keys are loaded from <PROVIDER>_API_KEY environment variables.",
        "",
    ].join("\n");

    fs.writeFileSync(modelsPath, `${banner}${yaml.stringify(defaultModelsConfig)}`, "utf8");
    return modelsPath;
}

export function getManagedDefaultConfigPathSync(): string {
    return path.join(resolveDiogenesAppPaths().configDir, "config.yaml");
}

export function getManagedModelsConfigPathSync(): string {
    return resolveDiogenesAppPaths().modelsConfigPath;
}

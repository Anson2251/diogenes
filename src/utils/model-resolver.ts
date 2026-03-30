import * as fs from "fs";
import * as yaml from "yaml";

import type { DiogenesConfig, ModelsConfig, ResolvedModel } from "../types";
import {
    getProviderApiKey,
    getProviderApiKeyEnvVarName,
} from "./api-key-manager";

/**
 * Model Resolution
 *
 * Resolves model configuration with support for:
 * - Model fallback (if requested model unavailable, use default)
 * - Automatic provider detection
 * - API key injection from environment
 */

import { z } from "zod";

const ProviderStyleSchema = z.enum(["openai", "anthropic"]);

export const ModelDefinitionSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    contextWindow: z.number().optional(),
    maxTokens: z.number().optional(),
    temperature: z.number().optional(),
});

export const ProviderDefinitionSchema = z.object({
    style: ProviderStyleSchema,
    baseURL: z.string().optional(),
    supportsToolRole: z.boolean().optional(),
    models: z.record(z.string(), ModelDefinitionSchema),
});

export const ModelsConfigSchema = z.object({
    providers: z.record(z.string(), ProviderDefinitionSchema),
    default: z.string().optional(),
});

/**
 * Parse models configuration from YAML string
 */
export function parseModelsConfig(content: string): ModelsConfig {
    const parsed: unknown = yaml.parse(content);
    return ModelsConfigSchema.parse(parsed);
}

/**
 * Load models configuration from file path
 */
export function loadModelsConfig(path: string): ModelsConfig | null {
    if (!fs.existsSync(path)) {
        return null;
    }
    const content = fs.readFileSync(path, "utf-8");
    return parseModelsConfig(content);
}

/**
 * Get environment variable name for a provider's API key
 * Re-export for backward compatibility
 */
export { getProviderApiKeyEnvVarName } from "./api-key-manager";

/**
 * List all available models from config
 */
export function listAvailableModels(config: ModelsConfig): string[] {
    const models: string[] = [];
    for (const [providerName, provider] of Object.entries(config.providers)) {
        for (const modelName of Object.keys(provider.models)) {
            models.push(`${providerName}/${modelName}`);
        }
    }
    return models;
}

/**
 * Resolve a specific model from config
 * Automatically injects API key from environment
 */
export function resolveModel(
    config: ModelsConfig,
    modelRef: string,
): ResolvedModel {
    const parts = modelRef.split("/");
    if (parts.length !== 2) {
        throw new Error(
            `Invalid model reference: ${modelRef}. Expected format: provider/model`,
        );
    }

    const [providerName, modelName] = parts;
    const provider = config.providers[providerName];
    if (!provider) {
        throw new Error(`Unknown provider: ${providerName}`);
    }

    const model = provider.models[modelName];
    if (!model) {
        throw new Error(
            `Unknown model: ${modelName} for provider ${providerName}`,
        );
    }

    const apiKey = getProviderApiKey(providerName);
    if (!apiKey) {
        const envVarName = getProviderApiKeyEnvVarName(providerName);
        throw new Error(
            `No API key found for provider "${providerName}". ` +
                `Set the ${envVarName} environment variable or add it to your .env file.`,
        );
    }

    return {
        provider: providerName,
        providerStyle: provider.style,
        supportsToolRole: provider.supportsToolRole ?? false,
        model: modelName,
        fullName: `${providerName}/${modelName}`,
        apiKey,
        baseURL: provider.baseURL,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens ?? model.contextWindow,
        temperature: model.temperature,
    };
}

/**
 * Resolve the default model from config
 */
export function resolveDefaultModel(
    config: ModelsConfig,
): ResolvedModel | null {
    if (!config.default) {
        return null;
    }
    return resolveModel(config, config.default);
}

/**
 * Resolve model configuration with fallback logic
 *
 * This is the main entry point for model resolution.
 * It handles:
 * 1. If a specific model is requested and available, use it
 * 2. If not available, fallback to default model
 * 3. If no default, return null
 *
 * @param modelsConfig - The models configuration
 * @param requestedModel - The requested model (from config, CLI, etc.)
 * @returns Resolved model info or null if cannot resolve
 */
export function resolveModelWithFallback(
    modelsConfig: ModelsConfig,
    requestedModel?: string,
): ResolvedModel | null {
    const modelRef = requestedModel ?? modelsConfig.default;
    if (!modelRef) {
        return null;
    }

    const available = listAvailableModels(modelsConfig);

    // If requested model is available, use it; otherwise fallback to default
    const modelToResolve = available.includes(modelRef)
        ? modelRef
        : modelsConfig.default;

    if (!modelToResolve) {
        return null;
    }

    try {
        return resolveModel(modelsConfig, modelToResolve);
    } catch (error) {
        // If fallback also fails, return null
        if (process.env.DIOGENES_DEBUG) {
            console.error(
                `Failed to resolve model ${modelToResolve}:`,
                error,
            );
        }
        return null;
    }
}

/**
 * Apply resolved model to DiogenesConfig
 *
 * Updates the llm configuration with resolved model details
 */
export function applyResolvedModel(
    config: Partial<DiogenesConfig>,
    resolved: ResolvedModel,
): void {
    const currentLLM = config.llm || {};
    config.llm = {
        ...currentLLM,
        provider: resolved.provider,
        providerStyle: resolved.providerStyle,
        supportsToolRole: resolved.supportsToolRole,
        model: resolved.model,
        apiKey: resolved.apiKey,
        baseURL: resolved.baseURL || currentLLM.baseURL,
        maxTokens: resolved.maxTokens ?? currentLLM.maxTokens,
        temperature: resolved.temperature ?? currentLLM.temperature,
    };
}

/**
 * Format models list for display
 */
export function formatModelsList(config: ModelsConfig): string {
    const lines: string[] = [];
    const defaultModel = config.default;

    for (const [providerName, provider] of Object.entries(config.providers)) {
        lines.push(`\n[${providerName}]`);
        lines.push(`  style: ${provider.style}`);
        lines.push(`  supportsToolRole: ${provider.supportsToolRole ?? false}`);
        lines.push(`  env: ${getProviderApiKeyEnvVarName(providerName)}`);
        if (provider.baseURL) {
            lines.push(`  baseURL: ${provider.baseURL}`);
        }
        lines.push("");

        for (const [modelName, model] of Object.entries(provider.models)) {
            const fullName = `${providerName}/${modelName}`;
            const isDefault = fullName === defaultModel;
            const marker = isDefault ? " *" : "  ";
            const desc = model.description ? ` - ${model.description}` : "";
            lines.push(`${marker}${modelName}${desc}`);
        }
    }

    if (defaultModel) {
        lines.push(`\nDefault: ${defaultModel}`);
    }

    return lines.join("\n");
}
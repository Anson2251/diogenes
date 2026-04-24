import * as fs from "fs";
import * as yaml from "yaml";
import { z } from "zod";

import type { ModelsConfig, ResolvedModel } from "../types";

import {
    getProviderApiKey,
    getProviderApiKeyEnvVarName,
    MissingApiKeyError,
} from "./api-key-manager";

const ProviderStyleSchema = z.enum(["openai", "anthropic"]);

export const ModelDefinitionSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    contextWindow: z.number().optional(),
    maxTokens: z.number().optional(),
    temperature: z.number().optional(),
    supportsInterleavedThinking: z.boolean().optional(),
    supportsNativeToolCalls: z.boolean().optional(),
});

export const ProviderDefinitionSchema = z.object({
    style: ProviderStyleSchema,
    baseURL: z.string().optional(),
    supportsToolRole: z.boolean().optional(),
    models: z.record(z.string(), ModelDefinitionSchema),
    supportsNativeToolCalls: z.boolean().optional(),
});

export const ModelsConfigSchema = z.object({
    providers: z.record(z.string(), ProviderDefinitionSchema),
    default: z.string().optional(),
});

// Re-export for backward compatibility
export { getProviderApiKeyEnvVarName } from "./api-key-manager";

export function parseModelsConfig(content: string): ModelsConfig {
    const parsed: unknown = yaml.parse(content);
    return ModelsConfigSchema.parse(parsed);
}

export function loadModelsConfig(path: string): ModelsConfig | null {
    if (!fs.existsSync(path)) {
        return null;
    }
    const content = fs.readFileSync(path, "utf-8");
    return parseModelsConfig(content);
}

export function listAvailableModels(config: ModelsConfig): string[] {
    const models: string[] = [];
    for (const [providerName, provider] of Object.entries(config.providers)) {
        for (const modelName of Object.keys(provider.models)) {
            models.push(`${providerName}/${modelName}`);
        }
    }
    return models;
}

export function resolveModel(config: ModelsConfig, modelRef: string): ResolvedModel {
    const slashIndex = modelRef.indexOf("/");
    if (slashIndex <= 0 || slashIndex >= modelRef.length - 1) {
        throw new Error(`Invalid model reference: ${modelRef}. Expected format: provider/model`);
    }

    const providerName = modelRef.slice(0, slashIndex);
    const modelName = modelRef.slice(slashIndex + 1);
    const provider = config.providers[providerName];
    if (!provider) {
        throw new Error(`Unknown provider: ${providerName}`);
    }

    const model = provider.models[modelName];
    if (!model) {
        throw new Error(`Unknown model: ${modelName} for provider ${providerName}`);
    }

    const apiKey = getProviderApiKey(providerName);
    if (!apiKey) {
        throw new MissingApiKeyError(providerName);
    }

    // Model-level settings override provider-level
    // For supportsInterleavedThinking: only model-level setting matters (defaults to false)
    // For supportsNativeToolCalls: model overrides provider, provider defaults to true
    const supportsNativeToolCalls = model.supportsNativeToolCalls ?? provider.supportsNativeToolCalls ?? true;

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
        supportsInterleavedThinking: model.supportsInterleavedThinking ?? false,
        supportsNativeToolCalls,
    };
}

export function resolveDefaultModel(config: ModelsConfig): ResolvedModel | null {
    if (!config.default) {
        return null;
    }
    return resolveModel(config, config.default);
}

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

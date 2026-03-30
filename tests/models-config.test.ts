import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    parseModelsConfig,
    loadModelsConfig,
    listAvailableModels,
    resolveModel,
    resolveDefaultModel,
    formatModelsList,
    ModelsConfigSchema,
} from "../src/utils/models-config";

describe("models-config", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    describe("ModelsConfigSchema", () => {
        it("validates minimal config", () => {
            const config = {
                providers: {
                    openai: {
                        style: "openai",
                        models: {
                            "gpt-4": { name: "GPT-4" },
                        },
                    },
                },
            };

            const result = ModelsConfigSchema.safeParse(config);
            expect(result.success).toBe(true);
        });

        it("validates full config", () => {
            const config = {
                providers: {
                    openai: {
                        style: "openai",
                        supportsToolRole: true,
                        baseURL: "https://api.openai.com/v1",
                        models: {
                            "gpt-4o": {
                                name: "GPT-4o",
                                description: "Most capable",
                                contextWindow: 128000,
                                maxTokens: 4096,
                                temperature: 0.7,
                            },
                        },
                    },
                },
                default: "openai/gpt-4o",
            };

            const result = ModelsConfigSchema.safeParse(config);
            expect(result.success).toBe(true);
        });

        it("rejects missing providers", () => {
            const config = {
                default: "openai/gpt-4",
            };

            const result = ModelsConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
        });

        it("rejects missing models", () => {
            const config = {
                providers: {
                    openai: {
                        style: "openai",
                        baseURL: "https://api.openai.com/v1",
                    },
                },
            };

            const result = ModelsConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
        });

        it("rejects missing provider style", () => {
            const config = {
                providers: {
                    openai: {
                        models: {
                            "gpt-4": { name: "GPT-4" },
                        },
                    },
                },
            };

            const result = ModelsConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
        });
    });

    describe("parseModelsConfig", () => {
        it("parses valid YAML", () => {
            const yaml = `
providers:
  openai:
    style: openai
    baseURL: https://api.openai.com/v1
    models:
      gpt-4o:
        name: GPT-4o
        contextWindow: 128000
default: openai/gpt-4o
`;

            const config = parseModelsConfig(yaml);
            expect(config.providers.openai.baseURL).toBe("https://api.openai.com/v1");
            expect(config.providers.openai.models["gpt-4o"].name).toBe("GPT-4o");
            expect(config.default).toBe("openai/gpt-4o");
        });
    });

    describe("loadModelsConfig", () => {
        it("returns null for missing file", async () => {
            const result = loadModelsConfig("/nonexistent/path/models.yaml");
            expect(result).toBeNull();
        });

        it("loads config from file", async () => {
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "models-config-"));
            tempDirs.push(tempDir);

            const configPath = path.join(tempDir, "models.yaml");
            await fs.writeFile(
                configPath,
                `
providers:
  test:
    style: openai
    models:
      model-1:
        name: Model 1
`,
                "utf8",
            );

            const config = loadModelsConfig(configPath);
            expect(config).not.toBeNull();
            expect(config?.providers.test.models["model-1"].name).toBe("Model 1");
        });
    });

    describe("listAvailableModels", () => {
        it("lists all models with provider prefix", () => {
            const config = {
                providers: {
                    openai: {
                        style: "openai",
                        models: {
                            "gpt-4o": { name: "GPT-4o" },
                            "gpt-3.5": { name: "GPT-3.5" },
                        },
                    },
                    anthropic: {
                        style: "anthropic",
                        models: {
                            "claude-3": { name: "Claude 3" },
                        },
                    },
                },
            };

            const models = listAvailableModels(config as any);
            expect(models).toEqual(
                expect.arrayContaining(["openai/gpt-4o", "openai/gpt-3.5", "anthropic/claude-3"]),
            );
            expect(models).toHaveLength(3);
        });
    });

    describe("resolveModel", () => {
        const config = {
            providers: {
                openai: {
                    style: "openai",
                    baseURL: "https://api.openai.com/v1",
                    models: {
                        "gpt-4o": {
                            name: "GPT-4o",
                            contextWindow: 128000,
                            maxTokens: 4096,
                            temperature: 0.5,
                        },
                    },
                },
                custom: {
                    style: "anthropic",
                    baseURL: "https://custom.api/v1",
                    models: {
                        "model-1": {
                            name: "Custom Model",
                        },
                    },
                },
            },
        };

        it("resolves model with provider env key and style", () => {
            vi.stubEnv("OPENAI_API_KEY", "sk-provider-key");

            const resolved = resolveModel(config as any, "openai/gpt-4o");

            expect(resolved.provider).toBe("openai");
            expect(resolved.providerStyle).toBe("openai");
            expect(resolved.model).toBe("gpt-4o");
            expect(resolved.fullName).toBe("openai/gpt-4o");
            expect(resolved.apiKey).toBe("sk-provider-key");
            expect(resolved.baseURL).toBe("https://api.openai.com/v1");
            expect(resolved.contextWindow).toBe(128000);
            expect(resolved.maxTokens).toBe(4096);
            expect(resolved.temperature).toBe(0.5);
        });

        it("resolves model with derived provider env key", () => {
            vi.stubEnv("CUSTOM_API_KEY", "sk-env-key");

            const resolved = resolveModel(config as any, "custom/model-1");

            expect(resolved.provider).toBe("custom");
            expect(resolved.providerStyle).toBe("anthropic");
            expect(resolved.model).toBe("model-1");
            expect(resolved.apiKey).toBe("sk-env-key");
            expect(resolved.baseURL).toBe("https://custom.api/v1");
        });

        it("throws for invalid format", () => {
            expect(() => resolveModel(config as any, "invalid")).toThrow(
                "Invalid model reference: invalid",
            );
        });

        it("throws for unknown provider", () => {
            expect(() => resolveModel(config as any, "unknown/model")).toThrow(
                "Unknown provider: unknown",
            );
        });

        it("throws for unknown model", () => {
            expect(() => resolveModel(config as any, "openai/unknown")).toThrow(
                "Unknown model: unknown",
            );
        });

        it("throws when no apiKey available", () => {
            expect(() => resolveModel(config as any, "custom/model-1")).toThrow(
                "No API key found for provider custom. Expected environment variable CUSTOM_API_KEY",
            );
        });
    });

    describe("resolveDefaultModel", () => {
        it("returns null when no default set", () => {
            const config = {
                providers: {
                    openai: {
                        style: "openai",
                        models: { "gpt-4": { name: "GPT-4" } },
                    },
                },
            };

            const result = resolveDefaultModel(config as any);
            expect(result).toBeNull();
        });

        it("resolves default model", () => {
            vi.stubEnv("OPENAI_API_KEY", "sk-key");

            const config = {
                providers: {
                    openai: {
                        style: "openai",
                        models: { "gpt-4": { name: "GPT-4" } },
                    },
                },
                default: "openai/gpt-4",
            };

            const result = resolveDefaultModel(config as any);
            expect(result).not.toBeNull();
            expect(result?.fullName).toBe("openai/gpt-4");
        });
    });

    describe("formatModelsList", () => {
        it("formats models list with default marker", () => {
            const config = {
                providers: {
                    openai: {
                        style: "openai",
                        supportsToolRole: true,
                        baseURL: "https://api.openai.com/v1",
                        models: {
                            "gpt-4o": { name: "GPT-4o", description: "Most capable" },
                            "gpt-3.5": { name: "GPT-3.5" },
                        },
                    },
                },
                default: "openai/gpt-4o",
            };

            const output = formatModelsList(config as any);

            expect(output).toContain("[openai]");
            expect(output).toContain("style: openai");
            expect(output).toContain("supportsToolRole: true");
            expect(output).toContain("env: OPENAI_API_KEY");
            expect(output).toContain("baseURL: https://api.openai.com/v1");
            expect(output).toContain("*gpt-4o - Most capable");
            expect(output).toContain(" gpt-3.5");
            expect(output).toContain("Default: openai/gpt-4o");
        });

        it("handles no default", () => {
            const config = {
                providers: {
                    test: {
                        style: "openai",
                        models: {
                            "model-1": { name: "Model 1" },
                        },
                    },
                },
            };

            const output = formatModelsList(config as any);
            expect(output).toContain("supportsToolRole: false");
            expect(output).toContain("env: TEST_API_KEY");
            expect(output).not.toContain("Default:");
        });
    });
});

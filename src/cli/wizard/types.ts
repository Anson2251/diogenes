/**
 * Wizard types and interfaces
 */

import type { ModelsConfig } from "../../types";

export type WizardStep = "menu" | "provider" | "model" | "default" | "settings" | "done";

export interface WizardContext {
    modelsConfig: ModelsConfig;
    modelsConfigPath: string;
    configPath: string;
    changed: boolean;
}

export interface WizardOptions {
    step?: string;
    nonInteractive?: boolean;
}

export interface StepResult {
    next: WizardStep;
    changed: boolean;
}

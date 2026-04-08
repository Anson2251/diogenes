import { execSync } from "child_process";
import * as path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "../..");

export function setup(): void {
    console.log("\n🔨 Bundling project for e2e tests...");
    try {
        execSync("pnpm bundle:all", {
            cwd: PROJECT_ROOT,
            stdio: "inherit",
            timeout: 120000,
        });
        console.log("✅ Bundle complete\n");
    } catch (error) {
        console.log("⚠️ Bundle step may have failed or bundles already exist\n");
    }
}

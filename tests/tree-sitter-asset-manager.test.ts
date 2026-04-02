import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveDiogenesAppPaths } from "../src/utils/app-paths";
import {
    TREE_SITTER_WASMS_VERSION,
    TreeSitterAssetManager,
} from "../src/utils/tree-sitter-asset-manager";

describe("TreeSitterAssetManager", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    it("downloads a grammar using mirror fallback and records manifest metadata", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "tree-sitter-assets-"));
        tempDirs.push(root);

        const appPaths = resolveDiogenesAppPaths({
            platform: "linux",
            homeDir: root,
            env: {
                XDG_CONFIG_HOME: path.join(root, "config"),
                XDG_DATA_HOME: path.join(root, "data"),
            },
        });

        const wasmDir = path.join(
            path.dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")),
            "wasm",
        );

        const fetchMock = vi.fn(async (url: string) => {
            if (url.includes("unpkg.com")) {
                return new Response("unavailable", { status: 503 });
            }

            const fileName = path.basename(new URL(url).pathname);
            const data = await fs.readFile(path.join(wasmDir, fileName));
            return new Response(data, { status: 200 });
        });

        const manager = new TreeSitterAssetManager({
            appPaths,
            fetchImpl: fetchMock as typeof fetch,
        });

        const status = await manager.ensureGrammar("typescript");

        expect(status.availability).toBe("downloaded");
        expect(status.grammarPath).toContain("tree-sitter-typescript.wasm");
        expect(status.sourceHost).toBe("npm.elemecdn.com");

        const manifest = await manager.getManifest();
        expect(manifest.packageVersion).toBe(TREE_SITTER_WASMS_VERSION);
        expect(manifest.grammars.typescript?.sourceHost).toBe("npm.elemecdn.com");

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

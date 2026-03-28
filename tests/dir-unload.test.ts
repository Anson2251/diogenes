import { beforeEach, describe, expect, it } from "vitest";

import { DirUnloadTool } from "../src/tools/dir/dir-unload";

describe("DirUnloadTool", () => {
    let workspace: { unloadDirectory: (path: string) => boolean };
    let tool: DirUnloadTool;

    beforeEach(() => {
        workspace = {
            unloadDirectory: (path: string) => path === "src/utils",
        };
        tool = new DirUnloadTool(workspace);
    });

    it("should unload a loaded directory successfully", async () => {
        const result = await tool.execute({ path: "src/utils" });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ success: true, path: "src/utils" });
    });

    it("should return not found when directory is not loaded", async () => {
        const result = await tool.execute({ path: "missing" });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("NOT_FOUND");
        expect(result.error?.details?.path).toBe("missing");
    });
});

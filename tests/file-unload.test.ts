import { beforeEach, describe, expect, it } from "vitest";

import { FileUnloadTool } from "../src/tools/file/file-unload";

describe("FileUnloadTool", () => {
    let workspace: { unloadFile: (path: string) => boolean };
    let tool: FileUnloadTool;

    beforeEach(() => {
        workspace = {
            unloadFile: (path: string) => path === "loaded.txt",
        };
        tool = new FileUnloadTool(workspace);
    });

    it("should unload a loaded file successfully", async () => {
        const result = await tool.execute({ path: "loaded.txt" });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ success: true, path: "loaded.txt" });
    });

    it("should return not found when file is not loaded", async () => {
        const result = await tool.execute({ path: "missing.txt" });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("NOT_FOUND");
        expect(result.error?.details?.path).toBe("missing.txt");
    });

    it("should validate missing path parameter", async () => {
        const result = await tool.execute({});

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("INVALID_PARAMS");
    });
});

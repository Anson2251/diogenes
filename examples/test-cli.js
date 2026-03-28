#!/usr/bin/env node

/**
 * Test script to verify the CLI works
 * This simulates basic CLI usage without actually calling the LLM
 */

const { spawn } = require("child_process");
const path = require("path");

console.log("Testing Diogenes CLI...\n");

// Test 1: Help command
console.log("Test 1: Help command");
const helpTest = spawn("node", [path.join(__dirname, "..", "dist", "cli.js"), "--help"]);

helpTest.stdout.on("data", (data) => {
    console.log(data.toString());
});

helpTest.stderr.on("data", (data) => {
    console.error("Error:", data.toString());
});

helpTest.on("close", (code) => {
    console.log(`Help test exited with code ${code}\n`);

    // Test 2: Version command
    console.log("Test 2: Version command");
    const versionTest = spawn("node", [path.join(__dirname, "..", "dist", "cli.js"), "--version"]);

    versionTest.stdout.on("data", (data) => {
        console.log(data.toString());
    });

    versionTest.stderr.on("data", (data) => {
        console.error("Error:", data.toString());
    });

    versionTest.on("close", (code) => {
        console.log(`Version test exited with code ${code}\n`);

        // Test 3: Missing API key error
        console.log("Test 3: Missing API key error (expected)");
        const errorTest = spawn("node", [
            path.join(__dirname, "..", "dist", "cli.js"),
            "test task",
        ]);

        errorTest.stdout.on("data", (data) => {
            console.log(data.toString());
        });

        errorTest.stderr.on("data", (data) => {
            console.log("Expected error:", data.toString());
        });

        errorTest.on("close", (code) => {
            console.log(`Error test exited with code ${code}\n`);
            console.log("CLI tests completed!");
            console.log("\nTo run actual tasks, set OPENAI_API_KEY environment variable:");
            console.log('export OPENAI_API_KEY="your-api-key-here"');
            console.log("\nThen try:");
            console.log('node dist/cli.js --api-key sk-test "List files in current directory"');
        });
    });
});

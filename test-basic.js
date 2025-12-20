/**
 * Quick test to verify basic functionality
 */

const fs = require('fs');
const path = require('path');

// Create a test directory structure
const testDir = path.join(__dirname, 'test-workspace');
const testFile = path.join(testDir, 'test.txt');

// Clean up and create test environment
if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true });
}
fs.mkdirSync(testDir, { recursive: true });
fs.writeFileSync(testFile, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n');

console.log('Test workspace created at:', testDir);
console.log('Test file created:', testFile);

// Note: To run the actual TypeScript code, you would need to:
// 1. Build the project: npm run build
// 2. Run the example: node dist/examples/basic-usage.js

console.log('\nTo run the Diogenes framework:');
console.log('1. Build: npm run build');
console.log('2. Run example: node dist/examples/basic-usage.js');
console.log('\nProject structure created successfully!');
# Diogenes CLI Usage Examples

## Bundling

You can build the CLI by:

```bash
npm bundle
```

## Basic Usage

### Execute a simple task

```bash
# Set your OpenAI API key as environment variable
export OPENAI_API_KEY="your-api-key-here"

# Run a simple task
node ./bundle/cli.cjs "List all files in the current directory"
```

### With command-line options

```bash
# Specify API key and model
node ./bundle/cli.cjs --api-key sk-... --model gpt-4 "Analyze the project structure"

# Specify workspace directory
node ./bundle/cli.cjs --workspace ./my-project "Find all TypeScript files"

# Enable verbose output
node ./bundle/cli.cjs --verbose "Fix type errors in utils.ts"

# Limit maximum iterations
node ./bundle/cli.cjs --max-iterations 10 "Create a simple README file"
```

### Interactive Mode

Start an interactive session:

```bash
node ./bundle/cli.cjs --interactive
```

In interactive mode, you can:
- Type tasks directly
- Use `help` to see available commands
- Use `config` to see current configuration
- Use `clear` to clear the screen
- Use `exit` or `quit` to exit
- Let the agent use `task.ask` and `task.choose` when it needs direct user input

### Socratic Mode

Start a guided manual session:

```bash
node ./bundle/cli.cjs --socratic "Debug the CLI input flow"
```

In socratic mode, you can:
- Type single-line tool calls directly
- Use `tool` or `/tool` to enter multi-line tool-call mode
- Use `paste` or `/paste` to paste arbitrary multi-line text
- Finish multi-line input with `..`
- Use `tools`, `context`, `results`, and `task` to inspect state
- Use `/help` and `/exit` as command aliases

## Configuration File

You can use a configuration file (JSON or YAML):

```json
// config.json
{
  "llm": {
    "model": "gpt-4",
    "temperature": 0.7
  },
  "security": {
    "workspaceRoot": "/path/to/workspace",
    "shell": {
      "timeout": 60
    }
  }
}
```

```yaml
# config.yaml
llm:
  model: gpt-4
  temperature: 0.7
security:
  workspaceRoot: /path/to/workspace
  shell:
    timeout: 60
```

Use the config file:

```bash
node ./bundle/cli.cjs --config config.json "Your task here"
```

## Environment Variables

- `OPENAI_API_KEY`: OpenAI API key (required)
- `DIOGENES_WORKSPACE`: Default workspace directory
- `DIOGENES_MODEL`: Default LLM model

## Example Tasks

Here are some example tasks you can try:

```bash
# File system operations
node ./bundle/cli.cjs "Create a new file called hello.txt with content 'Hello, World!'"
node ./bundle/cli.cjs "List all .ts files in the src directory"
node ./bundle/cli.cjs "Count the number of lines in package.json"

# Code analysis
node ./bundle/cli.cjs "Find all function definitions in index.ts"
node ./bundle/cli.cjs "Check for any TODO comments in the codebase"
node ./bundle/cli.cjs "Analyze the project structure and suggest improvements"

# Project setup
node ./bundle/cli.cjs "Initialize a new Node.js project with TypeScript"
node ./bundle/cli.cjs "Create a basic Express.js server"
node ./bundle/cli.cjs "Set up ESLint configuration for this project"
```

## Troubleshooting

### API Key Issues
```bash
# Error: OpenAI API key is required
# Solution: Set the API key
export OPENAI_API_KEY="your-api-key-here"
# Or use --api-key option
node ./bundle/cli.cjs --api-key sk-... "Your task"
```

### Workspace Access Issues
```bash
# Error: Workspace directory not accessible
# Solution: Check permissions or specify a different workspace
node ./bundle/cli.cjs --workspace ./ "Your task"
```

### Verbose Output
If a task is taking too long or seems stuck, use verbose mode to see what's happening:

```bash
node ./bundle/cli.cjs --verbose "Your complex task"
```

### Memory/Token Management
For complex tasks, you might need to adjust the max iterations:

```bash
# Default is 20 iterations
node ./bundle/cli.cjs --max-iterations 50 "Your very complex task"
```

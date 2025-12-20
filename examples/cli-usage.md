# Diogenes CLI Usage Examples

## Installation

After building the project, you can install the CLI globally:

```bash
# From the project directory
npm install -g .
```

Or use it directly:

```bash
# Using npx with the built CLI
npx diogenes --help

# Or from the project directory
node dist/cli.js --help
```

## Basic Usage

### Execute a simple task

```bash
# Set your OpenAI API key as environment variable
export OPENAI_API_KEY="your-api-key-here"

# Run a simple task
diogenes "List all files in the current directory"
```

### With command-line options

```bash
# Specify API key and model
diogenes --api-key sk-... --model gpt-4 "Analyze the project structure"

# Specify workspace directory
diogenes --workspace ./my-project "Find all TypeScript files"

# Enable verbose output
diogenes --verbose "Fix type errors in utils.ts"

# Limit maximum iterations
diogenes --max-iterations 10 "Create a simple README file"
```

### Interactive Mode

Start an interactive session:

```bash
diogenes --interactive
```

In interactive mode, you can:
- Type tasks directly
- Use `help` to see available commands
- Use `config` to see current configuration
- Use `clear` to clear the screen
- Use `exit` or `quit` to exit

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
diogenes --config config.json "Your task here"
```

## Environment Variables

- `OPENAI_API_KEY`: OpenAI API key (required)
- `DIOGENES_WORKSPACE`: Default workspace directory
- `DIOGENES_MODEL`: Default LLM model

## Example Tasks

Here are some example tasks you can try:

```bash
# File system operations
diogenes "Create a new file called hello.txt with content 'Hello, World!'"
diogenes "List all .ts files in the src directory"
diogenes "Count the number of lines in package.json"

# Code analysis
diogenes "Find all function definitions in index.ts"
diogenes "Check for any TODO comments in the codebase"
diogenes "Analyze the project structure and suggest improvements"

# Project setup
diogenes "Initialize a new Node.js project with TypeScript"
diogenes "Create a basic Express.js server"
diogenes "Set up ESLint configuration for this project"
```

## Troubleshooting

### API Key Issues
```bash
# Error: OpenAI API key is required
# Solution: Set the API key
export OPENAI_API_KEY="your-api-key-here"
# Or use --api-key option
diogenes --api-key sk-... "Your task"
```

### Workspace Access Issues
```bash
# Error: Workspace directory not accessible
# Solution: Check permissions or specify a different workspace
diogenes --workspace ./ "Your task"
```

### Verbose Output
If a task is taking too long or seems stuck, use verbose mode to see what's happening:

```bash
diogenes --verbose "Your complex task"
```

### Memory/Token Management
For complex tasks, you might need to adjust the max iterations:

```bash
# Default is 20 iterations
diogenes --max-iterations 50 "Your very complex task"
```
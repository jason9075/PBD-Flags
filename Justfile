set shell := ["sh", "-c"]

# List all available recipes.
default:
    @just --list

# Start the development server on port 8080.
dev:
    @echo "\033[36m[Nord] Running gfx-lab dev server...\033[0m"
    live-server --port 8080 .

# Trigger a workspace refresh for live-server.
refresh:
    @echo "\033[34m[Nord] Triggering workspace refresh...\033[0m"
    touch index.html

# Print tool versions.
check:
    @live-server --version 2>&1 || true
    @just --version

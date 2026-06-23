.PHONY: dev build preview install clean docker up down lint typecheck help

## Development

install:              ## Install dependencies
	npm install

dev:                  ## Start dev server on :5173 (proxies /api to query-api)
	npm run dev

build:                ## Type-check and build for production
	npm run build

preview:              ## Preview production build locally
	npm run preview

## Quality

typecheck:            ## Run vue-tsc type checking
	npx vue-tsc --noEmit

lint:                 ## Lint with vue-tsc
	npx vue-tsc --noEmit

## Docker

docker:               ## Build Docker image
	docker build -t wide-web-ui:latest .

up:                   ## Run web-ui in Docker (nginx on :5180, proxies to host query-api)
	docker compose up -d --build

down:                 ## Stop Docker services
	docker compose down

## Cleanup

clean:                ## Remove build artifacts
	rm -rf dist node_modules

## Help

help:                 ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help

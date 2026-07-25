.PHONY: dev build preview install ensure-deps test clean docker up down lint typecheck help

## Development

install:              ## Install dependencies
	npm install

ensure-deps:          ## Repair/install dependencies when the local install is incomplete
	@if [ ! -f node_modules/vite/bin/vite.js ]; then \
		echo "web-ui dependencies are missing or incomplete; running npm install..."; \
		npm install; \
	fi

dev: ensure-deps       ## Start dev server on :5173 (proxies /api to query-api)
	npm run dev

build: ensure-deps     ## Type-check and build for production
	npm run build

preview: ensure-deps   ## Preview production build locally
	npm run preview

## Quality

test: ensure-deps      ## Run unit tests (vitest)
	npm test

typecheck: ensure-deps ## Run vue-tsc type checking
	npx vue-tsc --noEmit

lint: ensure-deps      ## Lint with vue-tsc
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

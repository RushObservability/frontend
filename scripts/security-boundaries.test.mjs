import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer, isFileServingAllowed } from 'vite'
import { spawnSync } from 'node:child_process'

describe('development file boundary', () => {
  it('allows app files but rejects sibling repositories and credential files', async () => {
    const server = await createServer({
      server: { middlewareMode: true, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    })
    try {
      expect(isFileServingAllowed(resolve('src/main.ts'), server)).toBe(true)
      expect(isFileServingAllowed(resolve('../query-api/Cargo.toml'), server)).toBe(false)
      expect(isFileServingAllowed(resolve('../frontend-license/package.json'), server)).toBe(false)
      expect(isFileServingAllowed(resolve('.env'), server)).toBe(false)
      expect(server.config.server.allowedHosts).not.toContain('.ngrok-free.app')
    } finally { await server.close() }
  })

  it('limits licensed composition access to the specified dependency directory', async () => {
    const dependencyCheckout = resolve('../security-test-dependency-checkout')
    vi.stubEnv('VITE_ADDITIONAL_FS_ROOT', dependencyCheckout)
    const server = await createServer({
      server: { middlewareMode: true, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    })
    try {
      expect(server.config.server.fs.allow).toContain(`${dependencyCheckout}/node_modules`)
      expect(server.config.server.fs.allow).not.toContain(dependencyCheckout)
      expect(isFileServingAllowed(`${dependencyCheckout}/src/main.ts`, server)).toBe(false)
    } finally { await server.close(); vi.unstubAllEnvs() }
  })
})

describe('release promotion', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  it('skips a push release when only package metadata changes', () => {
    expect(workflow).toContain('if: needs.release-plan.outputs.needed == \'true\'')
    expect(workflow).toContain('[[ "$previous" == "$current" ]]')
    expect(workflow).toContain('[[ "$EVENT_NAME" == push')
  })
  it('only publishes candidate tags before both scans, user checks, and attestations', () => {
    const beforePromotion = workflow.split('      - name: Promote verified digest to release tags')[0]
    expect(beforePromotion).toContain(':candidate-${{ github.run_id }}-${{ github.run_attempt }}')
    expect(beforePromotion).not.toContain('tags: ${{ steps.docker-meta.outputs.tags }}')
    for (const marker of ['TRIVY_PLATFORM: linux/amd64', 'TRIVY_PLATFORM: linux/arm64', 'for arch in amd64 arm64', '      - name: Attest image SBOM']) {
      expect(beforePromotion).toContain(marker)
    }
    expect(beforePromotion).not.toContain('continue-on-error: true')
    expect(workflow.indexOf('Promote verified digest')).toBeLessThan(workflow.indexOf('Create tag and GitHub release'))
  })

  it('promotes the supplied digest without rebuilding and refuses malformed inputs', () => {
    const digest = `sha256:${'a'.repeat(64)}`
    const run = overrides => spawnSync('bash', ['-c', `docker() { printf '%s\\n' "$@"; }; export -f docker; source scripts/promote-image.sh`], {
      encoding: 'utf8', env: { ...process.env, IMAGE_REPOSITORY: 'ghcr.io/example/frontend', INDEX_DIGEST: digest,
        RELEASE_TAGS: 'ghcr.io/example/frontend:0.1.10\nghcr.io/example/frontend:0.1', ...overrides },
    })
    const result = run({})
    expect(result.status).toBe(0)
    expect(result.stdout.trim().split('\n')).toEqual(['buildx', 'imagetools', 'create', '--tag', 'ghcr.io/example/frontend:0.1.10', '--tag', 'ghcr.io/example/frontend:0.1', `ghcr.io/example/frontend@${digest}`])
    for (const input of [{ INDEX_DIGEST: 'latest' }, { RELEASE_TAGS: 'other/image:tag' }, { RELEASE_TAGS: 'ghcr.io/example/frontend:bad tag' }, { RELEASE_TAGS: '' }]) {
      expect(run(input).status).not.toBe(0)
      expect(run(input).stdout).toBe('')
    }
  })
})

import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const privateSourcePaths = [
  'src/views/integrations/postgres',
  'src/views/integrations/mysql',
  'src/finops',
  'src/views/FinOpsView.vue',
  'src/views/KubernetesAccessView.vue',
  'src/views/KubernetesLoginView.vue',
  'src/views/settings/KubernetesLoggingSettings.vue',
  'src/views/settings/MySqlSettings.vue',
  'src/views/settings/LicenseSettings.vue',
  'src/views/settings/LicensedRuntimeSettings.vue',
  'src/license',
  'src/kubernetes-access',
  'src/lib/kubernetesAccess.ts',
  'src/lib/kubernetesResult.ts',
  'src/lib/kubernetesSessionReplay.ts',
]

const leakedSource = privateSourcePaths.filter((path) => existsSync(resolve(path)))
if (leakedSource.length) {
  throw new Error(`Private integration source is present in the open-source tree:\n${leakedSource.join('\n')}`)
}

const assetsDirectory = resolve('dist/assets')
if (!existsSync(assetsDirectory)) {
  throw new Error('dist/assets does not exist. Run the production build before this check.')
}

const privateChunkPattern = /^(Pg|MySql|FinOpsView|LicenseSettings|LicensedRuntimeSettings|Kubernetes(?:AccessView|LoginView|LoggingSettings))[^/]*\.(?:js|css)$/
const leakedChunks = readdirSync(assetsDirectory).filter((name) => privateChunkPattern.test(name))
if (leakedChunks.length) {
  throw new Error(`Private integration chunks are present in the open-source build:\n${leakedChunks.join('\n')}`)
}

console.log('Open-source edition contains no private integration source or build chunks.')

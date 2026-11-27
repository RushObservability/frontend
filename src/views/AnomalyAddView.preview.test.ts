import { describe, expect, it } from 'vitest'
import source from './AnomalyAddView.vue?raw'

describe('anomaly detector preview', () => {
  it('ignores a slower earlier preview response', () => {
    expect(source).toContain('const generation = ++previewGeneration')
    expect(source).toContain('if (generation !== previewGeneration) return false')
    expect(source).toContain('await loadPreviewData(matchedMetrics.value, newLabels)')
    expect(source).toContain('await loadPreviewData(matchedMetrics.value, selectedLabels.value)')
    expect(source).toContain('if (await loadPreviewData(metrics, selectedLabels.value)) previewPattern.value')
    expect(source.match(/previewData\.value = await fetchMetrics\(/g)).toBeNull()
  })
})

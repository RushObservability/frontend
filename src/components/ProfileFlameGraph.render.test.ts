import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import ProfileFlameGraph from './ProfileFlameGraph.vue'
import { cpuTime } from '../lib/profiles'

const stacks = [{ frames: ['main', 'parse'], cpu_seconds: 3 }, { frames: ['main', 'encode'], cpu_seconds: 0.01 }]

function frame(html: string, name: string) {
  const tag = html.match(new RegExp(`<button[^>]*><span[^>]*>${name}</span>`))?.[0] ?? ''
  const attr = (key: string) => tag.match(new RegExp(` ${key}="([^"]*)"`))?.[1]
  return { classes: attr('class')?.split(' ').sort(), title: attr('title'), label: attr('aria-label') }
}

describe('flame graph frames', () => {
  it('renders the same title, label and classes from the precomputed frame data', async () => {
    const html = await renderToString(createSSRApp(ProfileFlameGraph, { stacks, search: 'PARSE' }))
    expect(frame(html, 'parse')).toEqual({
      classes: ['cpu-high', 'flame-frame', 'matched'],
      title: `parse\nTotal: ${cpuTime(3)} · Self: ${cpuTime(3)}\n${(3 / 3.01 * 100).toFixed(1)}% of all CPU`,
      label: `parse, ${cpuTime(3)} total CPU. Zoom into this stack.`,
    })
    expect(frame(html, 'encode').classes).toEqual(['cpu-low', 'dimmed', 'flame-frame'])
  })

  it('leaves frames unmarked without a search', async () => {
    const html = await renderToString(createSSRApp(ProfileFlameGraph, { stacks }))
    expect(frame(html, 'parse').classes).toEqual(['cpu-high', 'flame-frame'])
    expect(html).not.toMatch(/dimmed|matched/)
  })
})

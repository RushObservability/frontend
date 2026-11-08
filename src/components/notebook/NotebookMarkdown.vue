<script setup lang="ts">
import { computed } from 'vue'
import { parseMarkdown } from '../../lib/markdownBlocks'

const props = defineProps<{ source: string }>()
const blocks = computed(() => parseMarkdown(props.source))
</script>

<template>
  <div class="nb-md">
    <template v-for="(block, b) in blocks" :key="b">
      <component :is="`h${block.level + 1}`" v-if="block.kind === 'heading'" class="nb-md-h">
        <template v-for="(part, p) in block.inline" :key="p">
          <strong v-if="part.kind === 'strong'">{{ part.text }}</strong><code v-else-if="part.kind === 'code'">{{ part.text }}</code><template v-else>{{ part.text }}</template>
        </template>
      </component>
      <p v-else-if="block.kind === 'paragraph'">
        <template v-for="(line, l) in block.lines" :key="l">
          <br v-if="l > 0" />
          <template v-for="(part, p) in line" :key="p">
            <strong v-if="part.kind === 'strong'">{{ part.text }}</strong><code v-else-if="part.kind === 'code'">{{ part.text }}</code><template v-else>{{ part.text }}</template>
          </template>
        </template>
      </p>
      <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.kind === 'list'">
        <li v-for="(item, it) in block.items" :key="it">
          <template v-for="(part, p) in item" :key="p">
            <strong v-if="part.kind === 'strong'">{{ part.text }}</strong><code v-else-if="part.kind === 'code'">{{ part.text }}</code><template v-else>{{ part.text }}</template>
          </template>
        </li>
      </component>
      <pre v-else><code>{{ block.text }}</code></pre>
    </template>
  </div>
</template>

<style scoped>
.nb-md { font-size: var(--text-md); line-height: 1.6; }
.nb-md > * + * { margin-top: 6px; }
.nb-md-h { font-size: var(--text-md); font-weight: 650; }
.nb-md ul, .nb-md ol { padding-left: 18px; }
.nb-md code { padding: 0 3px; border-radius: 3px; background: var(--bg-overlay); font-family: var(--font-mono); font-size: var(--text-sm); }
.nb-md pre { padding: 8px; overflow-x: auto; border-radius: var(--r-sm); background: var(--bg-root); }
.nb-md pre code { padding: 0; background: none; }
</style>

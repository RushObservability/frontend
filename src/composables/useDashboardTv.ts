import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter, type RouteLocationNormalizedLoaded } from 'vue-router'

export function isDashboardTv(route: RouteLocationNormalizedLoaded): boolean {
  return route.name === 'dashboard' && route.query.tv === '1'
}

export function useDashboardTv() {
  const route = useRoute()
  const router = useRouter()
  const active = computed(() => isDashboardTv(route))
  const enterButton = useTemplateRef<HTMLButtonElement>('tvEnterButton')
  const exitButton = useTemplateRef<HTMLButtonElement>('tvExitButton')
  const fullscreen = ref(false)
  let ownsFullscreen = false
  let disposed = false

  async function leaveFullscreen() {
    if (!ownsFullscreen) return
    ownsFullscreen = false
    if (document.fullscreenElement) {
      try { await document.exitFullscreen() } catch { /* The browser may already be exiting. */ }
    }
    fullscreen.value = false
  }

  async function enterFullscreen(navigation: Promise<unknown> = Promise.resolve()) {
    if (!document.documentElement.requestFullscreen || document.fullscreenElement) return
    ownsFullscreen = true
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      ownsFullscreen = true
      fullscreen.value = true
      await navigation
      if (disposed || !active.value) await leaveFullscreen()
    } catch {
      // Dashboard-only mode still works when native fullscreen is unavailable.
      ownsFullscreen = false
      fullscreen.value = false
    }
  }

  function requestFullscreen() { return enterFullscreen() }

  async function enter() {
    const navigation = router.replace({ query: { ...route.query, tv: '1' }, hash: route.hash })
    // Keep this call inside the click's user gesture, before awaiting navigation.
    const nativeFullscreen = enterFullscreen(navigation)
    await navigation
    await nextTick()
    exitButton.value?.focus({ preventScroll: true })
    await nativeFullscreen
  }

  async function exit() {
    if (!active.value) return
    const query = { ...route.query }
    delete query.tv
    await router.replace({ query, hash: route.hash })
    await leaveFullscreen()
    await nextTick()
    enterButton.value?.focus({ preventScroll: true })
  }

  function onFullscreenChange() {
    fullscreen.value = document.fullscreenElement === document.documentElement
    if (ownsFullscreen && !document.fullscreenElement) {
      ownsFullscreen = false
      void exit()
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && active.value) {
      event.preventDefault()
      void exit()
    }
  }

  watch(active, enabled => {
    if (!enabled) void leaveFullscreen()
  })

  onMounted(() => {
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('keydown', onKeydown)
    if (active.value) exitButton.value?.focus({ preventScroll: true })
  })

  onUnmounted(() => {
    disposed = true
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    document.removeEventListener('keydown', onKeydown)
    void leaveFullscreen()
  })

  return { active, fullscreen, enter, exit, requestFullscreen }
}

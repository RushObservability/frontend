import type { RumEvent } from '@rushobservability/rum-sdk'

const PRIVATE_RUM_PATHS = [
  /^\/login(?:\/|$)/,
  /^\/setup\/sso(?:\/|$)/,
  /^\/settings(?:\/|$)/,
  /^\/kubernetes-access\/login(?:\/|$)/,
]

const PRIVATE_EVENT_TYPES = new Set(['error', 'frustration', 'interaction'])
const SAFE_ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/

function isPrivatePath(pathname: string): boolean {
  return PRIVATE_RUM_PATHS.some(pattern => pattern.test(pathname))
}

function interactionElement(target: string | undefined): string | undefined {
  if (!target) return undefined
  const tag = target.match(/^[a-z][a-z0-9-]*/i)?.[0]
  return tag?.toLowerCase() || 'element'
}

/**
 * Keep operational RUM signals without shipping visible UI text, identifiers,
 * exception messages, or stack frames from the browser.
 */
export function sanitizeRumEvent(
  event: RumEvent,
  pathname = globalThis.location?.pathname || '/',
): RumEvent | null {
  if (isPrivatePath(pathname) && PRIVATE_EVENT_TYPES.has(event.event_type)) return null

  const sanitized: RumEvent = { ...event }

  if (sanitized.error_message !== undefined || sanitized.error_stack !== undefined) {
    sanitized.error_message = 'Client error'
    delete sanitized.error_stack
    sanitized.error_type = SAFE_ERROR_TYPE.test(sanitized.error_type || '')
      ? sanitized.error_type
      : 'Error'
  }

  if (sanitized.interaction_target !== undefined) {
    sanitized.interaction_target = interactionElement(sanitized.interaction_target)
  }

  return sanitized
}

interface MatchRequest { pattern: string; names: string[]; limit: number }
const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<MatchRequest>) => void
  postMessage: (result: { names?: string[]; error?: string }) => void
}

worker.onmessage = ({ data }) => {
  try {
    const regex = new RegExp(data.pattern)
    const names: string[] = []
    for (const name of data.names) {
      if (regex.test(name)) names.push(name)
      if (names.length >= data.limit) break
    }
    worker.postMessage({ names })
  } catch { worker.postMessage({ error: 'This detector has an invalid metric pattern.' }) }
}

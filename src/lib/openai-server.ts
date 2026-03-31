export function getOpenAIBaseUrl() {
  return String(process.env.OPENAI_API_ENDPOINT ?? "https://api.openai.com/v1").trim().replace(/\/+$/, "")
}

export function getOpenAIUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${getOpenAIBaseUrl()}${normalizedPath}`
}

export function getOpenAITimeoutSignal(timeoutMs: number) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs)
  }

  return undefined
}
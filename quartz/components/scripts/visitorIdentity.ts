const visitorStorageKey = "markz.reactions.visitor.v1"
const visitorPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let volatileVisitor: string | undefined

export function readVisitorStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeVisitorStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The current page can still register once when storage is unavailable.
  }
}

export function visitorId(): string {
  const stored = readVisitorStorage(visitorStorageKey)
  if (stored && visitorPattern.test(stored)) return stored
  if (!volatileVisitor) volatileVisitor = crypto.randomUUID()
  writeVisitorStorage(visitorStorageKey, volatileVisitor)
  return volatileVisitor
}

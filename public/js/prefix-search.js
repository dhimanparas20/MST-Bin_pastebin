// Prefix search modal shared by the editor (index.html) and viewer (paste.html).
// Opens from #prefixSearchBtn, queries GET /api/search?prefix=..., and lists
// matching pastes as links. Results only contain metadata, never paste content.
document.addEventListener("DOMContentLoaded", () => {
  const openBtn = document.getElementById("prefixSearchBtn")
  if (!openBtn) return

  const PREFIX_RE = /^[a-zA-Z0-9-]{1,15}$/
  const STORAGE_KEY = "mstbin:lastPrefix"

  const modal = document.createElement("div")
  modal.id = "prefixSearchModal"
  modal.className = "fixed inset-0 z-50 flex items-start justify-center"
  modal.style.cssText = "display:none;background:rgba(0,0,0,0.7);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);"
  modal.innerHTML = `
    <div class="glassmorphism-modal rounded-xl p-4 sm:p-6 w-11/12 max-w-2xl mx-auto mt-16 sm:mt-20 flex flex-col prefix-search-dialog"
         role="dialog" aria-modal="true" aria-labelledby="prefixSearchTitle">
      <div class="flex items-center justify-between mb-3">
        <h2 id="prefixSearchTitle" class="text-white text-base sm:text-lg font-bold">Search by prefix</h2>
        <button id="prefixSearchClose" type="button" class="text-purple-400 hover:text-white p-1 focus:outline-none" title="Close (Esc)" aria-label="Close">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <form id="prefixSearchForm" class="flex gap-2 mb-2" autocomplete="off">
        <label for="prefixSearchInput" class="sr-only">Prefix</label>
        <input id="prefixSearchInput" type="text" maxlength="16" placeholder="e.g. premagic"
          class="flex-1 min-w-0 bg-gray-800 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400">
        <button type="submit" class="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded text-sm whitespace-nowrap">Search</button>
      </form>
      <p id="prefixSearchStatus" class="text-xs text-purple-400 mb-2 ml-1" aria-live="polite">Shows pastes whose ID starts with <code>prefix_</code>.</p>
      <ul id="prefixSearchResults" class="prefix-search-results overflow-y-auto space-y-2 pr-1"></ul>
    </div>`
  document.body.appendChild(modal)

  const form = modal.querySelector("#prefixSearchForm")
  const input = modal.querySelector("#prefixSearchInput")
  const status = modal.querySelector("#prefixSearchStatus")
  const list = modal.querySelector("#prefixSearchResults")
  const closeBtn = modal.querySelector("#prefixSearchClose")

  let debounceTimer = null
  let requestSeq = 0
  let controller = null

  const normalize = (value) => value.trim().replace(/\s+/g, "-").replace(/_+$/, "")

  function readLastPrefix() {
    try { return localStorage.getItem(STORAGE_KEY) || "" } catch (e) { return "" }
  }

  function saveLastPrefix(prefix) {
    try { localStorage.setItem(STORAGE_KEY, prefix) } catch (e) { /* storage unavailable */ }
  }

  // On a paste page whose ID looks like "<prefix>_...", suggest that prefix.
  function prefixFromCurrentPath() {
    const match = decodeURIComponent(window.location.pathname.slice(1)).match(/^([a-zA-Z0-9-]{1,15})_/)
    return match ? match[1] : ""
  }

  function isOpen() { return modal.style.display !== "none" }

  function openModal() {
    modal.style.display = "flex"
    if (!input.value) input.value = prefixFromCurrentPath() || readLastPrefix()
    input.focus()
    input.select()
    if (input.value) runSearch()
  }

  function closeModal() {
    modal.style.display = "none"
    if (controller) controller.abort()
    openBtn.focus()
  }

  function badge(text, classes) {
    const el = document.createElement("span")
    el.className = `px-1.5 py-0.5 text-xs font-semibold rounded whitespace-nowrap ${classes}`
    el.textContent = text
    return el
  }

  function formatDate(epoch) {
    if (!epoch) return ""
    return new Date(epoch * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
  }

  function renderResult(paste) {
    const li = document.createElement("li")
    const link = document.createElement("a")
    link.href = "/" + encodeURIComponent(paste.key)
    link.className = "prefix-search-item block rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-yellow-400"

    const top = document.createElement("div")
    top.className = "flex items-center gap-2 flex-wrap mb-1"
    const key = document.createElement("code")
    key.className = "text-xs font-mono bg-gray-800 text-purple-200 px-1.5 py-0.5 rounded break-all"
    key.textContent = paste.key
    top.appendChild(key)
    top.appendChild(badge(paste.language, "bg-gray-700 text-purple-300 font-mono"))
    if (paste.password_protected) top.appendChild(badge("Password locked", "bg-red-900 text-red-300"))
    if (paste.view_once) top.appendChild(badge("VIEW ONCE", "bg-yellow-600 text-black"))
    if (paste.max_views) top.appendChild(badge(`Max ${paste.max_views} views`, "bg-purple-900 text-purple-300"))
    if (paste.encrypted_with === "server") top.appendChild(badge("Encrypted", "bg-green-900 text-green-300"))

    const title = document.createElement("p")
    title.className = "text-white font-semibold text-sm break-words"
    title.textContent = paste.heading || "My Paste"

    link.appendChild(top)
    link.appendChild(title)

    if (paste.description) {
      const desc = document.createElement("p")
      desc.className = "text-purple-200 text-xs mt-0.5 break-words whitespace-pre-wrap"
      desc.textContent = paste.description
      link.appendChild(desc)
    }

    const meta = document.createElement("p")
    meta.className = "text-purple-400 text-xs mt-1"
    const parts = []
    if (paste.created_at) parts.push(`Created ${formatDate(paste.created_at)}`)
    parts.push(`${paste.open_count} view${paste.open_count === 1 ? "" : "s"}${paste.max_views ? ` / ${paste.max_views}` : ""}`)
    if (paste.expires_text) parts.push(paste.expires_text)
    if (paste.view_once) parts.push("Opening it uses the single view")
    meta.textContent = parts.join(" · ")
    link.appendChild(meta)

    li.appendChild(link)
    return li
  }

  async function runSearch() {
    clearTimeout(debounceTimer)
    const prefix = normalize(input.value)
    list.replaceChildren()
    if (!prefix) {
      status.textContent = "Type a prefix to search."
      return
    }
    if (!PREFIX_RE.test(prefix)) {
      status.textContent = "Prefix must be 1-15 characters: letters, numbers or -."
      return
    }

    const seq = ++requestSeq
    if (controller) controller.abort()
    controller = new AbortController()
    status.textContent = "Searching…"

    try {
      const response = await fetch(`/api/search?prefix=${encodeURIComponent(prefix)}`, { signal: controller.signal })
      const data = await response.json()
      if (seq !== requestSeq) return
      if (!response.ok) {
        status.textContent = data.error || "Search failed. Please try again."
        return
      }
      saveLastPrefix(prefix)
      if (!data.results.length) {
        status.textContent = `No pastes found with prefix "${prefix}_".`
        return
      }
      const shown = data.results.length
      status.textContent = data.total > shown
        ? `Showing the ${shown} newest of ${data.total} pastes with prefix "${prefix}_".`
        : `${shown} paste${shown === 1 ? "" : "s"} with prefix "${prefix}_".`
      data.results.forEach((paste) => list.appendChild(renderResult(paste)))
    } catch (error) {
      if (error.name === "AbortError" || seq !== requestSeq) return
      status.textContent = "Search failed. Please try again."
    }
  }

  openBtn.addEventListener("click", openModal)
  closeBtn.addEventListener("click", closeModal)
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal() })
  form.addEventListener("submit", (e) => { e.preventDefault(); runSearch() })
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(runSearch, 300)
  })

  // Capture phase so Esc closes only this modal, not the page's panels underneath.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) {
      e.preventDefault()
      e.stopImmediatePropagation()
      closeModal()
    }
  }, true)
})

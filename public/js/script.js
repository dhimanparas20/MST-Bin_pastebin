document.addEventListener("DOMContentLoaded", () => {
  const pasteArea = document.getElementById("pasteArea")
  const lineNumbers = document.getElementById("lineNumbers")
  const languageSelect = document.getElementById("languageSelect")
  const customKeyInput = document.getElementById("customKey")
  const loadPasteKey = document.getElementById("loadPasteKey")
  const loadPasteBtn = document.getElementById("loadPasteBtn")
  const pastePassword = document.getElementById("pastePassword")
  const togglePassVis = document.getElementById("togglePassVis")
  const expiryValue = document.getElementById("expiryValue")
  const expiryUnit = document.getElementById("expiryUnit")

  // Sidebar elements
  const hamburgerBtn = document.getElementById("hamburgerBtn")
  const hamburgerIcon = document.getElementById("hamburgerIcon")
  const hamburgerCloseIcon = document.getElementById("hamburgerCloseIcon")
  const sidePanel = document.getElementById("sidePanel")
  const sidebarOverlay = document.getElementById("sidebarOverlay")
  const mainContent = document.getElementById("mainContent")
  const saveBtnTop = document.getElementById("saveBtnTop")
  const saveBtnSide = document.getElementById("saveBtnSide")

  // Lock toggle elements
  const lockToggleSide = document.getElementById("lockToggleSide")
  const lockStatusSide = document.getElementById("lockStatusSide")
  const lockIconUnlockedSide = document.getElementById("lockIconUnlockedSide")
  const lockIconLockedSide = document.getElementById("lockIconLockedSide")
  const passwordSection = document.getElementById("passwordSection")
  const eyeOffIcon = document.getElementById("eyeOffIcon")
  const eyeOnIcon = document.getElementById("eyeOnIcon")

  // Expiry toggle elements
  const expiryToggleSide = document.getElementById("expiryToggleSide")
  const expiryStatusSide = document.getElementById("expiryStatusSide")
  const expirySection = document.getElementById("expirySection")

  // View once toggle
  const viewOnceToggleSide = document.getElementById("viewOnceToggleSide")
  const viewOnceStatusSide = document.getElementById("viewOnceStatusSide")

  let isLocked = false
  let isExpiryOn = false
  let isViewOnce = false
  let sidebarOpen = false

  const MODE_MAP = {
    plaintext: null,
    python: "text/x-python",
    javascript: "text/javascript",
    typescript: "text/typescript",
    html: "text/html",
    css: "text/css",
    json: "application/json",
    bash: "text/x-sh",
    c: "text/x-csrc",
    cpp: "text/x-c++src",
    csharp: "text/x-csharp",
    java: "text/x-java",
    go: "text/x-go",
    rust: "text/x-rustsrc",
    sql: "text/x-sql",
    yaml: "text/x-yaml",
    xml: "application/xml",
    markdown: "text/x-markdown",
    php: "text/x-php",
    ruby: "text/x-ruby",
    kotlin: "text/x-kotlin",
    swift: "text/x-swift",
    lua: "text/x-lua",
    perl: "text/x-perl",
    dockerfile: "text/x-dockerfile",
    nginx: "text/x-nginx-conf"
  }

  const DYNAMIC_MODES = {
    typescript: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js",
    go: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/go/go.min.js",
    rust: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/rust/rust.min.js",
    kotlin: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/clike/clike.min.js",
    csharp: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/clike/clike.min.js",
    swift: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/swift/swift.min.js",
    lua: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/lua/lua.min.js",
    perl: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/perl/perl.min.js",
    dockerfile: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/dockerfile/dockerfile.min.js",
    nginx: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/nginx/nginx.min.js"
  }

  const HLJS_ALIAS_MAP = {
    "c++": "cpp", "c#": "csharp", "sh": "bash", "zsh": "bash", "shell": "bash",
    "js": "javascript", "ts": "typescript", "yml": "yaml", "rb": "ruby",
    "docker": "dockerfile", "cs": "csharp"
  }

  const MODE_PARENT_MAP = {
    csrc: "clike", "c++src": "clike", java: "clike", csharp: "clike", kotlin: "clike"
  }

  let currentLanguage = "auto"

  const editor = CodeMirror.fromTextArea(pasteArea, {
    lineNumbers: true, theme: "monokai", mode: null,
    lineWrapping: false, viewportMargin: Infinity,
    tabSize: 4, indentUnit: 4, indentWithTabs: false, autofocus: true
  })

  lineNumbers.style.display = "none"

  function detectLanguage(code) {
    if (!code || !code.trim()) return null
    const sample = code.substring(0, 5000)
    const result = hljs.highlightAuto(sample)
    if (result.relevance >= 3 && result.language) {
      const lang = HLJS_ALIAS_MAP[result.language] || result.language
      if (MODE_MAP.hasOwnProperty(lang)) return lang
    }
    return null
  }

  function setEditorMode(language) {
    if (language === "auto") { editor.setOption("mode", null); return }
    const mime = MODE_MAP[language]
    if (mime === undefined || mime === null) { editor.setOption("mode", null); return }
    const modeName = mime.split("/").pop()
    const parentMode = MODE_PARENT_MAP[modeName] || modeName
    if (CodeMirror.modes.hasOwnProperty(parentMode)) { editor.setOption("mode", mime); return }
    const scriptUrl = DYNAMIC_MODES[language]
    if (scriptUrl) {
      const script = document.createElement("script")
      script.src = scriptUrl
      script.onload = () => editor.setOption("mode", mime)
      document.head.appendChild(script)
    } else { editor.setOption("mode", null) }
  }

  function autoDetectAndSwitch() {
    const code = editor.getValue()
    const detected = detectLanguage(code)
    if (detected) { languageSelect.value = detected; currentLanguage = detected; setEditorMode(detected) }
  }

  languageSelect.addEventListener("change", () => {
    currentLanguage = languageSelect.value
    if (currentLanguage === "auto") autoDetectAndSwitch()
    else setEditorMode(currentLanguage)
    editor.focus()
  })

  let pasteDetectTimer = null
  editor.on("change", () => {
    if (currentLanguage === "auto") {
      clearTimeout(pasteDetectTimer)
      pasteDetectTimer = setTimeout(autoDetectAndSwitch, 600)
    }
  })

  // ===== SIDEBAR TOGGLE =====
  function openSidebar() {
    sidebarOpen = true
    sidePanel.style.transform = "translateX(0)"
    hamburgerIcon.classList.add("hidden")
    hamburgerCloseIcon.classList.remove("hidden")
    if (window.innerWidth < 640) {
      sidebarOverlay.classList.remove("hidden")
    } else {
      mainContent.style.marginRight = "288px"
    }
    saveBtnTop.classList.add("hidden")
    saveBtnSide.classList.remove("hidden")
  }

  function closeSidebar() {
    sidebarOpen = false
    sidePanel.style.transform = "translateX(100%)"
    hamburgerIcon.classList.remove("hidden")
    hamburgerCloseIcon.classList.add("hidden")
    sidebarOverlay.classList.add("hidden")
    mainContent.style.marginRight = "0"
    saveBtnTop.classList.remove("hidden")
    saveBtnSide.classList.add("hidden")
  }

  hamburgerBtn.addEventListener("click", () => {
    if (sidebarOpen) closeSidebar()
    else openSidebar()
  })

  sidebarOverlay.addEventListener("click", closeSidebar)

  // Default: open on desktop, closed on mobile
  if (window.innerWidth >= 640) {
    openSidebar()
  } else {
    closeSidebar()
  }

  window.addEventListener("resize", () => {
    if (window.innerWidth >= 640 && !sidebarOpen) {
      openSidebar()
    } else if (window.innerWidth < 640 && sidebarOpen) {
      closeSidebar()
    }
  })

  // ===== LOCK TOGGLE =====
  lockToggleSide.addEventListener("click", () => {
    isLocked = !isLocked
    if (isLocked) {
      passwordSection.classList.remove("hidden")
      lockIconUnlockedSide.classList.add("hidden")
      lockIconLockedSide.classList.remove("hidden")
      lockStatusSide.textContent = "on"
      lockStatusSide.classList.add("text-red-400")
      lockStatusSide.classList.remove("text-gray-500")
      pastePassword.focus()
    } else {
      passwordSection.classList.add("hidden")
      lockIconUnlockedSide.classList.remove("hidden")
      lockIconLockedSide.classList.add("hidden")
      lockStatusSide.textContent = "off"
      lockStatusSide.classList.remove("text-red-400")
      lockStatusSide.classList.add("text-gray-500")
      pastePassword.value = ""
    }
  })

  // ===== EYE TOGGLE =====
  togglePassVis.addEventListener("click", () => {
    if (pastePassword.type === "password") {
      pastePassword.type = "text"
      eyeOffIcon.classList.add("hidden")
      eyeOnIcon.classList.remove("hidden")
    } else {
      pastePassword.type = "password"
      eyeOffIcon.classList.remove("hidden")
      eyeOnIcon.classList.add("hidden")
    }
  })

  // ===== EXPIRY TOGGLE =====
  expiryToggleSide.addEventListener("click", () => {
    isExpiryOn = !isExpiryOn
    if (isExpiryOn) {
      expirySection.classList.remove("hidden")
      expiryStatusSide.textContent = "on"
      expiryStatusSide.classList.add("text-blue-400")
      expiryStatusSide.classList.remove("text-gray-500")
    } else {
      expirySection.classList.add("hidden")
      expiryStatusSide.textContent = "off"
      expiryStatusSide.classList.remove("text-blue-400")
      expiryStatusSide.classList.add("text-gray-500")
    }
  })

  // ===== VIEW ONCE TOGGLE =====
  viewOnceToggleSide.addEventListener("click", () => {
    isViewOnce = !isViewOnce
    if (isViewOnce) {
      viewOnceStatusSide.textContent = "on"
      viewOnceStatusSide.classList.add("text-yellow-400")
      viewOnceStatusSide.classList.remove("text-gray-500")
    } else {
      viewOnceStatusSide.textContent = "off"
      viewOnceStatusSide.classList.remove("text-yellow-400")
      viewOnceStatusSide.classList.add("text-gray-500")
    }
  })

  // ===== SPACE VALIDATION HELPER =====
  function hasSpaces(val) { return val.includes(" ") }

  // ===== SAVE =====
  function savePaste() {
    const data = editor.getValue()
    const headingInput = document.getElementById("pasteHeading")
    let heading = headingInput.value.trim()
    const customKey = customKeyInput.value.trim()

    if (!data.trim()) { alert("Please enter some text before saving."); return }
    if (!heading) heading = "My Paste"

    if (customKey) {
      if (hasSpaces(customKey)) { alert("Custom key must not contain spaces"); return }
      if (!/^[a-zA-Z0-9_-]{4,20}$/.test(customKey)) { alert("Custom key must be 4-20 characters (a-z, A-Z, 0-9, -, _)"); return }
    }

    let lang = currentLanguage
    if (lang === "auto") { const detected = detectLanguage(data); lang = detected || "plaintext" }

    const body = { data, heading, language: lang }
    if (customKey) body.custom_key = customKey

    if (isLocked) {
      const pw = pastePassword.value.trim()
      if (pw) {
        if (hasSpaces(pw)) { alert("Password must not contain spaces"); return }
        body.password = pw
      }
    }

    if (isExpiryOn) {
      const val = parseInt(expiryValue.value)
      if (isNaN(val) || val < 1) { alert("Please enter a valid expiry value"); return }
      body.expiry_value = val
      body.expiry_unit = expiryUnit.value
    }

    if (isViewOnce) body.view_once = true

    fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((response) => response.json())
      .then((result) => {
        if (result.url) window.location.href = result.url
        else alert(result.error || "Error saving paste. Please try again.")
      })
      .catch(() => alert("Error saving paste. Please try again."))
  }

  saveBtnSide.addEventListener("click", savePaste)
  saveBtnTop.addEventListener("click", savePaste)

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "s") { e.preventDefault(); savePaste() }
  })

  // ===== LOAD PASTE =====
  function loadPaste() {
    const key = loadPasteKey.value.trim()
    if (!key) return
    if (hasSpaces(key)) { alert("Paste ID must not contain spaces"); return }
    window.location.href = "/" + encodeURIComponent(key)
  }
  loadPasteBtn.addEventListener("click", loadPaste)
  loadPasteKey.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); loadPaste() }
  })

  // ===== Ctrl+V anywhere focuses editor =====
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      const activeEl = document.activeElement
      if (!activeEl || activeEl === document.body || activeEl.tagName === "BODY" || activeEl.tagName === "HTML") {
        e.preventDefault()
        editor.focus()
        editor.getDoc().replaceSelection("")
        navigator.clipboard.readText().then(text => {
          editor.getDoc().replaceSelection(text)
        }).catch(() => {})
      }
    }
  })

  // ===== Ctrl+A in editor =====
  editor.on("keydown", (editor, event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "a") {
      const doc = editor.getDoc()
      doc.setSelection({ line: 0, ch: 0 }, { line: doc.lastLine(), ch: doc.getLine(doc.lastLine()).length })
    }
  })

  // ===== MARGIN UPDATE =====
  function updateMainPadding() {
    const navbar = document.getElementById("navbar")
    const mc = document.getElementById("mainContent")
    mc.style.paddingTop = navbar.offsetHeight + "px"
  }
  window.addEventListener("load", updateMainPadding)
  window.addEventListener("resize", () => { updateMainPadding() })
  updateMainPadding()
})
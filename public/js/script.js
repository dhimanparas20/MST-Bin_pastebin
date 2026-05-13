document.addEventListener("DOMContentLoaded", () => {
  const pasteArea = document.getElementById("pasteArea")
  const lineNumbers = document.getElementById("lineNumbers")
  const saveBtn = document.getElementById("saveBtn")
  const languageSelect = document.getElementById("languageSelect")
  const customKeyInput = document.getElementById("customKey")
  const loadPasteKey = document.getElementById("loadPasteKey")
  const loadPasteBtn = document.getElementById("loadPasteBtn")

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
    "c++": "cpp",
    "c#": "csharp",
    "sh": "bash",
    "zsh": "bash",
    "shell": "bash",
    "js": "javascript",
    "ts": "typescript",
    "yml": "yaml",
    "rb": "ruby",
    "docker": "dockerfile",
    "cs": "csharp"
  }

  const MODE_PARENT_MAP = {
    csrc: "clike",
    "c++src": "clike",
    java: "clike",
    csharp: "clike",
    kotlin: "clike"
  }

  let currentLanguage = "auto"

  const editor = CodeMirror.fromTextArea(pasteArea, {
    lineNumbers: true,
    theme: "monokai",
    mode: null,
    lineWrapping: false,
    viewportMargin: Infinity,
    tabSize: 4,
    indentUnit: 4,
    indentWithTabs: false,
    autofocus: true
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
    if (language === "auto") {
      editor.setOption("mode", null)
      return
    }
    const mime = MODE_MAP[language]
    if (mime === undefined || mime === null) {
      editor.setOption("mode", null)
      return
    }
    const modeName = mime.split("/").pop()
    const parentMode = MODE_PARENT_MAP[modeName] || modeName
    if (CodeMirror.modes.hasOwnProperty(parentMode)) {
      editor.setOption("mode", mime)
      return
    }
    const scriptUrl = DYNAMIC_MODES[language]
    if (scriptUrl) {
      const script = document.createElement("script")
      script.src = scriptUrl
      script.onload = () => editor.setOption("mode", mime)
      document.head.appendChild(script)
    } else {
      editor.setOption("mode", null)
    }
  }

  function autoDetectAndSwitch() {
    const code = editor.getValue()
    const detected = detectLanguage(code)
    if (detected) {
      languageSelect.value = detected
      currentLanguage = detected
      setEditorMode(detected)
    }
  }

  languageSelect.addEventListener("change", () => {
    currentLanguage = languageSelect.value
    if (currentLanguage === "auto") {
      autoDetectAndSwitch()
    } else {
      setEditorMode(currentLanguage)
    }
    editor.focus()
  })

  let pasteDetectTimer = null
  editor.on("change", () => {
    if (currentLanguage === "auto") {
      clearTimeout(pasteDetectTimer)
      pasteDetectTimer = setTimeout(autoDetectAndSwitch, 600)
    }
  })

  function savePaste() {
    const data = editor.getValue()
    const headingInput = document.getElementById("pasteHeading")
    let heading = headingInput.value.trim()
    const customKey = customKeyInput.value.trim()

    if (!data.trim()) {
      alert("Please enter some text before saving.")
      return
    }

    if (!heading) heading = "My Paste"

    // client-side validation for custom key
    if (customKey && !/^[a-zA-Z0-9_-]{4,20}$/.test(customKey)) {
      alert("Custom key must be 4-20 characters using a-z, A-Z, 0-9, -, _")
      return
    }

    let lang = currentLanguage
    if (lang === "auto") {
      const detected = detectLanguage(data)
      lang = detected || "plaintext"
    }

    const body = { data, heading, language: lang }
    if (customKey) body.custom_key = customKey

    fetch("/api/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
      .then((response) => response.json())
      .then((result) => {
        if (result.url) {
          window.location.href = result.url
        } else {
          alert(result.error || "Error saving paste. Please try again.")
        }
      })
      .catch((error) => {
        console.error("Error:", error)
        alert("Error saving paste. Please try again.")
      })
  }

  saveBtn.addEventListener("click", savePaste)

  function loadPaste() {
    const key = loadPasteKey.value.trim()
    if (!key) return
    window.location.href = "/" + encodeURIComponent(key)
  }

  loadPasteBtn.addEventListener("click", loadPaste)
  loadPasteKey.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      loadPaste()
    }
  })

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "s") {
      e.preventDefault()
      savePaste()
    }
  })

  editor.on("keydown", (editor, event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "a") {
      const doc = editor.getDoc()
      doc.setSelection({ line: 0, ch: 0 }, { line: doc.lastLine(), ch: doc.getLine(doc.lastLine()).length })
    }
  })

  function updateMainPadding() {
    const navbar = document.getElementById("navbar")
    const mainContent = document.getElementById("mainContent")
    const navHeight = navbar.offsetHeight
    mainContent.style.marginTop = navHeight + "px"
  }

  window.addEventListener("load", updateMainPadding)
  window.addEventListener("resize", updateMainPadding)
  updateMainPadding()
})

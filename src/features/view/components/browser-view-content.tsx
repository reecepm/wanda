import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useViewScope } from '@/features/view/scope/view-scope-context'
import { useViewStore } from '@/features/view/store/view-store'
import { sanitizeBrowserUrl } from '@/features/view/utils/browser-url'
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiLockLine,
  RiRefreshLine,
} from '@/lib/icons'
import { orpcForPod } from '@/shared/orpc'

interface BrowserViewContentProps {
  itemId: string
  url: string
  onTitleChange?: (title: string) => void
}

export function BrowserViewContent({ itemId, url, onTitleChange }: BrowserViewContentProps) {
  // Pull podId from the view scope context — stable per pod page. Using
  // useViewStore.getState().activeEntityId would race during view
  // transitions and could route the persist to the WRONG pod's server.
  const { entityId: podId } = useViewScope()
  const safeInitialUrl = sanitizeBrowserUrl(url || '')
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const [currentUrl, setCurrentUrl] = useState(safeInitialUrl)
  const [inputUrl, setInputUrl] = useState(safeInitialUrl)
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [isSecure, setIsSecure] = useState(false)
  const [error, setError] = useState<{ code: number; description: string; url: string } | null>(null)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Gate events — ignore everything from the initial about:blank load
  const readyRef = useRef(false)
  // Stable ref for the URL to load on dom-ready (avoids putting it in useCallback deps)
  const initialUrlRef = useRef(safeInitialUrl)

  const partition = `persist:browser-${itemId}`

  const persistUrl = useCallback(
    (newUrl: string) => {
      const safeUrl = sanitizeBrowserUrl(newUrl)
      if (newUrl && !safeUrl) return
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      persistTimerRef.current = setTimeout(() => {
        useViewStore.getState().updatePodItemConfig(itemId, { url: safeUrl })
        // Route through the pod's owning server via the closed-over
        // podId — itemId is unambiguous on the owning server, but a
        // paired client's local server never heard of it.
        orpcForPod(podId)
          .podItem.updateConfig({ id: itemId, config: { url: safeUrl } })
          .catch((err) => console.error('[browser] persist url failed:', err))
      }, 1000)
    },
    [itemId, podId],
  )

  useEffect(() => {
    if ((url || '') === safeInitialUrl) return
    useViewStore.getState().updatePodItemConfig(itemId, { url: safeInitialUrl })
    orpcForPod(podId)
      .podItem.updateConfig({ id: itemId, config: { url: safeInitialUrl } })
      .catch((err) => console.error('[browser] sanitize stored url failed:', err))
  }, [itemId, podId, safeInitialUrl, url])

  // Stable refs for callbacks used inside the webview ref callback.
  // This avoids putting them in useCallback deps which would remount the webview.
  const persistUrlRef = useRef(persistUrl)
  const onTitleChangeRef = useRef(onTitleChange)
  useLayoutEffect(() => {
    persistUrlRef.current = persistUrl
    onTitleChangeRef.current = onTitleChange
  }, [persistUrl, onTitleChange])

  const cleanupRef = useRef<(() => void) | null>(null)

  // Stable ref callback — never changes identity, so the webview never remounts.
  const webviewCallback = useCallback((webview: Electron.WebviewTag | null) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    webviewRef.current = webview
    readyRef.current = false
    if (!webview) {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      return
    }

    const wv = webview

    function onDidNavigate(e: Electron.DidNavigateEvent) {
      if (!readyRef.current) return
      setCurrentUrl(e.url)
      setInputUrl(e.url)
      setIsLoading(false)
      setError(null)
      setCanGoBack(wv.canGoBack())
      setCanGoForward(wv.canGoForward())
      setIsSecure(e.url.startsWith('https://'))
      persistUrlRef.current(e.url)
    }

    function onDidNavigateInPage(e: Electron.DidNavigateInPageEvent) {
      if (!readyRef.current || !e.isMainFrame) return
      setCurrentUrl(e.url)
      setInputUrl(e.url)
      setCanGoBack(wv.canGoBack())
      setCanGoForward(wv.canGoForward())
      setIsSecure(e.url.startsWith('https://'))
      persistUrlRef.current(e.url)
    }

    function onDidStartLoading() {
      if (!readyRef.current) return
      setIsLoading(true)
      setError(null)
    }

    function onDidStopLoading() {
      if (!readyRef.current) return
      setIsLoading(false)
    }

    function onPageTitleUpdated(e: Electron.PageTitleUpdatedEvent) {
      onTitleChangeRef.current?.(e.title)
    }

    function onDidFailLoad(e: Electron.DidFailLoadEvent) {
      if (e.errorCode === -3 || !e.isMainFrame) return
      setIsLoading(false)
      setError({ code: e.errorCode, description: e.errorDescription, url: e.validatedURL })
    }

    function onNewWindow(e: Event & { url: string }) {
      e.preventDefault()
      const nextUrl = sanitizeBrowserUrl(e.url)
      if (!nextUrl) return
      wv.loadURL(nextUrl).catch((err) =>
        console.error('[browser] new-window load failed:', err instanceof Error ? err.message : String(err)),
      )
    }

    wv.addEventListener('did-navigate', onDidNavigate as EventListener)
    wv.addEventListener('did-navigate-in-page', onDidNavigateInPage as EventListener)
    wv.addEventListener('did-start-loading', onDidStartLoading)
    wv.addEventListener('did-stop-loading', onDidStopLoading)
    wv.addEventListener('did-fail-load', onDidFailLoad as EventListener)
    wv.addEventListener('page-title-updated', onPageTitleUpdated as EventListener)
    wv.addEventListener('new-window', onNewWindow as EventListener)

    // `dom-ready` is an Electron-specific webview event not covered by
    // the DOM HTMLElementEventMap — cast to a generic EventListener
    // signature so we keep some type safety over `any`.
    ;(wv.addEventListener as (type: string, listener: EventListener, opts?: AddEventListenerOptions) => void)(
      'dom-ready',
      () => {
        readyRef.current = true
        const targetUrl = initialUrlRef.current
        if (targetUrl) {
          wv.loadURL(targetUrl).catch((err) =>
            console.error('[browser] initial load failed:', err instanceof Error ? err.message : String(err)),
          )
        }
      },
      { once: true },
    )

    cleanupRef.current = () => {
      wv.removeEventListener('did-navigate', onDidNavigate as EventListener)
      wv.removeEventListener('did-navigate-in-page', onDidNavigateInPage as EventListener)
      wv.removeEventListener('did-start-loading', onDidStartLoading)
      wv.removeEventListener('did-stop-loading', onDidStopLoading)
      wv.removeEventListener('did-fail-load', onDidFailLoad as EventListener)
      wv.removeEventListener('page-title-updated', onPageTitleUpdated as EventListener)
      wv.removeEventListener('new-window', onNewWindow as EventListener)
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    }
  }, [])

  function navigateTo(targetUrl: string) {
    let normalized = targetUrl.trim()
    if (!normalized) return
    normalized = sanitizeBrowserUrl(normalized)
    if (!normalized) return

    // Already has a protocol — use as-is
    if (/^[\w-]+:\/\//i.test(normalized)) {
      // pass through
    } else if (
      /^localhost(:\d+)?(\/|$)/i.test(normalized) ||
      /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(normalized) ||
      /^\[[\da-f:]+\](:\d+)?(\/|$)/i.test(normalized)
    ) {
      // localhost, IPv4, or IPv6 — default to http
      normalized = `http://${normalized}`
    } else if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(normalized)) {
      // Looks like a domain (has dots) — default to https
      normalized = `https://${normalized}`
    } else {
      // Treat as search query
      normalized = `https://www.google.com/search?q=${encodeURIComponent(normalized)}`
    }

    readyRef.current = true
    setInputUrl(normalized)
    webviewRef.current
      ?.loadURL(normalized)
      .catch((err) => console.error('[browser] navigation failed:', err instanceof Error ? err.message : String(err)))
  }

  function handleUrlKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      navigateTo(inputUrl)
      urlInputRef.current?.blur()
    }
    if (e.key === 'Escape') {
      setInputUrl(currentUrl)
      urlInputRef.current?.blur()
    }
    // Stop propagation so canvas/view shortcuts don't fire
    e.stopPropagation()
  }

  function handleUrlFocus() {
    // Select all text on focus for easy replacement
    setTimeout(() => urlInputRef.current?.select(), 0)
  }

  return (
    <div className="flex flex-col h-full w-full bg-zinc-950">
      {/* Navigation bar */}
      <div className="flex items-center gap-1 h-8 px-1.5 bg-zinc-900 border-b border-zinc-800 shrink-0">
        {/* Back / Forward / Reload */}
        <button
          type="button"
          disabled={!canGoBack}
          onClick={() => webviewRef.current?.goBack()}
          className="p-1 rounded-md hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:text-zinc-700 disabled:hover:bg-transparent transition-colors"
          title="Back"
        >
          <RiArrowLeftLine className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!canGoForward}
          onClick={() => webviewRef.current?.goForward()}
          className="p-1 rounded-md hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:text-zinc-700 disabled:hover:bg-transparent transition-colors"
          title="Forward"
        >
          <RiArrowRightLine className="h-3.5 w-3.5" />
        </button>
        {isLoading ? (
          <button
            type="button"
            onClick={() => webviewRef.current?.stop()}
            className="p-1 rounded-md hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Stop"
          >
            <RiCloseLine className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => webviewRef.current?.reload()}
            className="p-1 rounded-md hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Reload"
          >
            <RiRefreshLine className="h-3.5 w-3.5" />
          </button>
        )}

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-1.5 h-6 px-2 rounded-md bg-zinc-800 border border-zinc-700 focus-within:border-zinc-500 transition-colors">
          {isSecure && <RiLockLine className="h-3 w-3 text-green-500 shrink-0" />}
          {isLoading && <RiLoader4Line className="h-3 w-3 text-zinc-500 shrink-0 animate-spin" />}
          <input
            ref={urlInputRef}
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleUrlKeyDown}
            onFocus={handleUrlFocus}
            placeholder="Search or enter URL"
            className="flex-1 bg-transparent border-none outline-none text-xs text-zinc-300 placeholder:text-zinc-600"
            spellCheck={false}
          />
        </div>
      </div>

      {/* Webview + error overlay */}
      <div className="flex-1 min-h-0 relative">
        <webview ref={webviewCallback} src="about:blank" partition={partition} className="w-full h-full" allowpopups />
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 text-zinc-400 gap-3 px-8">
            <RiErrorWarningLine className="h-10 w-10 text-zinc-600" />
            <p className="text-sm font-medium text-zinc-300">
              {error.code === -102 || error.code === -105
                ? 'This site can\u2019t be reached'
                : error.code === -106
                  ? 'No internet connection'
                  : error.code === -501
                    ? 'Certificate error'
                    : 'This page isn\u2019t working'}
            </p>
            <p className="text-xs text-zinc-500 text-center max-w-sm">
              {error.code === -102 || error.code === -105
                ? `${error.url} refused to connect. Check if the server is running.`
                : error.description}
            </p>
            <button
              type="button"
              onClick={() => {
                setError(null)
                webviewRef.current?.reload()
              }}
              className="mt-2 px-3 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              Reload
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

import type { WandaAPI } from '../../electron/preload'
import type React from 'react'

declare global {
  interface Window {
    wanda: WandaAPI
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<Electron.WebviewTag> & {
          allowpopups?: boolean
          partition?: string
          src?: string
        },
        Electron.WebviewTag
      >
    }
  }
}

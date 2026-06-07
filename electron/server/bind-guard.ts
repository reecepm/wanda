// -----------------------------------------------------------------------------
// Refuse to bind a non-loopback HTTP listener without operator acknowledgement.
// Session tokens travel plaintext over HTTP + WS; a LAN/Tailnet-visible bind
// exposes them to anyone on the same network. TLS termination is not yet wired,
// so the only supported paths are loopback (default) or an explicit opt-in.
// -----------------------------------------------------------------------------

import { log } from '../packages/logger'

export function ensureNonLoopbackAllowed(listenHost: string): void {
  const tlsCert = process.env.WANDA_TLS_CERT_PATH
  const tlsKey = process.env.WANDA_TLS_KEY_PATH
  const insecureOptIn = process.env.WANDA_INSECURE_LAN === '1'

  if (tlsCert && tlsKey) {
    throw new Error(
      `WANDA_TLS_CERT_PATH + WANDA_TLS_KEY_PATH are set, but TLS termination ` +
        `is not yet wired in this build. Remove them and either bind loopback ` +
        `(WANDA_LISTEN_HOST=127.0.0.1) or set WANDA_INSECURE_LAN=1 to accept ` +
        `the plaintext risk explicitly.`,
    )
  }

  if (!insecureOptIn) {
    throw new Error(
      `Refusing to bind plain HTTP on non-loopback host "${listenHost}". ` +
        `Session tokens would travel unencrypted. Set WANDA_INSECURE_LAN=1 to ` +
        `acknowledge the risk, or bind to 127.0.0.1 (default). TLS support is ` +
        `planned; WANDA_TLS_CERT_PATH / WANDA_TLS_KEY_PATH will gate that.`,
    )
  }

  log.main.warn(
    `⚠ binding plain HTTP on non-loopback host "${listenHost}". ` +
      `Session tokens and RPC payloads travel unencrypted. ` +
      `Do not run this outside a trusted network (VPN / Tailnet).`,
  )
}

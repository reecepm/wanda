import { describe, expect, it } from 'vitest'
import { buildEditorUrl } from '../editor-url'

describe('buildEditorUrl', () => {
  it('returns a file:// URL for local workspaces (no SSH)', () => {
    expect(buildEditorUrl('/Users/example/work/wanda', null)).toBe('file:///Users/example/work/wanda')
  })

  it('falls back to file:/// when workspace cwd is empty', () => {
    expect(buildEditorUrl('', null)).toBe('file:///')
  })

  it('builds cursor://vscode-remote/ssh-remote+ for paired servers with SSH', () => {
    expect(buildEditorUrl('/home/user/work/wanda', { host: 'example-host', user: 'user' })).toBe(
      'cursor://vscode-remote/ssh-remote+user@example-host/home/user/work/wanda',
    )
  })

  it('omits user when not provided', () => {
    expect(buildEditorUrl('/srv/app', { host: 'vps.example.com' })).toBe(
      'cursor://vscode-remote/ssh-remote+vps.example.com/srv/app',
    )
  })

  it('includes non-default port', () => {
    expect(buildEditorUrl('/srv/app', { host: 'vps.example.com', user: 'admin', port: 2222 })).toBe(
      'cursor://vscode-remote/ssh-remote+admin@vps.example.com:2222/srv/app',
    )
  })

  it('omits port when it is the default (22)', () => {
    expect(buildEditorUrl('/srv/app', { host: 'host', user: 'admin', port: 22 })).toBe(
      'cursor://vscode-remote/ssh-remote+admin@host/srv/app',
    )
  })

  it('defaults to / when workspace cwd is empty and SSH is set', () => {
    expect(buildEditorUrl('', { host: 'host', user: 'admin' })).toBe('cursor://vscode-remote/ssh-remote+admin@host/')
  })
})

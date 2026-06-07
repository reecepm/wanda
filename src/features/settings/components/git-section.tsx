import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { SectionHeader } from '@/layout/section-header'
import { RiFolderOpenLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Separator } from '@/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

const GIT_SETTING_KEYS = [
  'git.branchPrefix.mode',
  'git.branchPrefix.custom',
  'git.defaultWorktreesDir',
  'git.worktreeCleanup',
  'github.username',
] as const

function FieldRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <div className="text-xs font-medium text-zinc-300">{label}</div>
        {description && <div className="text-xs text-zinc-500 mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function GitSection() {
  const queryClient = useQueryClient()
  const setSettingMutation = useMutation({
    ...orpcUtils.settings.set.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpcUtils.settings.getMany.key() })
    },
  })
  const selectDirectoryMutation = useMutation(orpcUtils.app.selectDirectory.mutationOptions())

  const { data: ghStatus, isLoading: ghLoading } = useQuery({
    ...orpcUtils.app.checkGitHubCli.queryOptions({}),
    staleTime: 60_000,
  })

  const { data: settings } = useQuery(
    orpcUtils.settings.getMany.queryOptions({ input: { keys: [...GIT_SETTING_KEYS] } }),
  )

  const prefixMode = settings?.['git.branchPrefix.mode'] ?? 'none'
  const customPrefix = settings?.['git.branchPrefix.custom'] ?? ''
  const defaultWorktreesDir = settings?.['git.defaultWorktreesDir'] ?? ''
  const worktreeCleanup = settings?.['git.worktreeCleanup'] ?? 'keep'
  const savedUsername = settings?.['github.username'] ?? ''

  // Auto-detect GitHub username
  useEffect(() => {
    if (ghStatus?.username && ghStatus.username !== savedUsername) {
      setSettingMutation.mutate({ key: 'github.username', value: ghStatus.username })
    }
  }, [ghStatus?.username, savedUsername, setSettingMutation])

  function saveSetting(key: string, value: string | null) {
    setSettingMutation.mutate({ key, value })
  }

  async function selectWorktreesDirectory() {
    return selectDirectoryMutation.mutateAsync({})
  }

  const detectedUsername = ghStatus?.username ?? savedUsername
  const settingsFormKey = `${customPrefix}\0${defaultWorktreesDir}`

  return (
    <div>
      <SectionHeader title="Git" description="Git integration, branch naming, and worktree defaults." />

      {/* GitHub CLI status */}
      <FieldRow label="GitHub CLI" description="Used for branch name prefixing and authentication.">
        <div className="flex items-center gap-2">
          {ghLoading ? (
            <span className="text-xs text-zinc-500">Checking...</span>
          ) : ghStatus?.authenticated ? (
            <>
              <span className="size-2 rounded-full bg-emerald-500" />
              <span className="text-xs text-zinc-300">Signed in as {ghStatus.username}</span>
            </>
          ) : ghStatus?.installed ? (
            <>
              <span className="size-2 rounded-full bg-amber-500" />
              <span className="text-xs text-zinc-400">Not authenticated</span>
            </>
          ) : (
            <>
              <span className="size-2 rounded-full bg-red-500" />
              <span className="text-xs text-zinc-400">Not installed</span>
            </>
          )}
        </div>
      </FieldRow>

      {!ghStatus?.authenticated && !ghLoading && (
        <p className="text-[10px] text-zinc-600 -mt-1 mb-2">
          Run <code className="text-zinc-500">gh auth login</code> in your terminal to authenticate.
        </p>
      )}

      <Separator />

      <GitSettingsForm
        key={settingsFormKey}
        prefixMode={prefixMode}
        customPrefix={customPrefix}
        defaultWorktreesDir={defaultWorktreesDir}
        worktreeCleanup={worktreeCleanup}
        detectedUsername={detectedUsername}
        onSaveSetting={saveSetting}
        onSelectDirectory={selectWorktreesDirectory}
      />
    </div>
  )
}

function GitSettingsForm({
  prefixMode,
  customPrefix,
  defaultWorktreesDir,
  worktreeCleanup,
  detectedUsername,
  onSaveSetting,
  onSelectDirectory,
}: {
  prefixMode: string
  customPrefix: string
  defaultWorktreesDir: string
  worktreeCleanup: string
  detectedUsername: string
  onSaveSetting: (key: string, value: string | null) => void
  onSelectDirectory: () => Promise<string | null>
}) {
  const [localCustomPrefix, setLocalCustomPrefix] = useState(customPrefix)
  const [localWorktreesDir, setLocalWorktreesDir] = useState(defaultWorktreesDir)

  async function handleBrowseWorktreesDir() {
    const dir = await onSelectDirectory()
    if (dir) {
      setLocalWorktreesDir(dir)
      onSaveSetting('git.defaultWorktreesDir', dir)
    }
  }

  return (
    <>
      <FieldRow label="Branch name prefix" description="Prefix added to branch names when creating worktrees for pods.">
        <ToggleGroup
          value={[prefixMode]}
          onValueChange={(value) => {
            if (value[0]) onSaveSetting('git.branchPrefix.mode', value[0])
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="github" disabled={!detectedUsername}>
            {detectedUsername ? detectedUsername : 'GitHub'}
          </ToggleGroupItem>
          <ToggleGroupItem value="custom">Custom</ToggleGroupItem>
          <ToggleGroupItem value="none">None</ToggleGroupItem>
        </ToggleGroup>
      </FieldRow>

      {prefixMode === 'custom' && (
        <div className="flex items-center gap-2 -mt-1 mb-2">
          <Input
            className="w-44"
            value={localCustomPrefix}
            onChange={(e) => setLocalCustomPrefix(e.target.value)}
            onBlur={() => onSaveSetting('git.branchPrefix.custom', localCustomPrefix.trim() || null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveSetting('git.branchPrefix.custom', localCustomPrefix.trim() || null)
            }}
            placeholder="my-prefix"
          />
          <span className="text-[10px] text-zinc-600">e.g. {localCustomPrefix || 'prefix'}/feature-name</span>
        </div>
      )}

      <Separator />

      {/* Default worktrees directory */}
      <FieldRow
        label="Default worktrees directory"
        description="Where worktrees are created by default. Can be overridden per workspace."
      >
        <div className="flex items-center gap-1">
          <Input
            className="w-44 font-mono"
            value={localWorktreesDir}
            onChange={(e) => setLocalWorktreesDir(e.target.value)}
            onBlur={() => onSaveSetting('git.defaultWorktreesDir', localWorktreesDir.trim() || null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveSetting('git.defaultWorktreesDir', localWorktreesDir.trim() || null)
            }}
            placeholder="/path/to/worktrees"
          />
          <Button type="button" variant="outline" size="icon-sm" onClick={handleBrowseWorktreesDir}>
            <RiFolderOpenLine className="h-3.5 w-3.5" />
          </Button>
        </div>
      </FieldRow>

      <Separator />

      {/* Worktree cleanup */}
      <FieldRow
        label="Worktree cleanup on pod delete"
        description="What happens to the git worktree when its pod is deleted."
      >
        <ToggleGroup
          value={[worktreeCleanup]}
          onValueChange={(value) => {
            if (value[0]) onSaveSetting('git.worktreeCleanup', value[0])
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="keep">Keep</ToggleGroupItem>
          <ToggleGroupItem value="remove">Remove</ToggleGroupItem>
          <ToggleGroupItem value="ask">Ask</ToggleGroupItem>
        </ToggleGroup>
      </FieldRow>
      <p className="text-[10px] text-zinc-600 -mt-1">
        {worktreeCleanup === 'keep'
          ? 'Pod deleted, worktree and branch kept on disk.'
          : worktreeCleanup === 'remove'
            ? 'Worktree and branch are automatically removed.'
            : 'You will be asked before removing the worktree.'}
      </p>
    </>
  )
}

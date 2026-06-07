import { GraphiteSection } from '../graphite-section'
import { useSettingsFormContext } from './context'
import { SectionHeading } from './fields'

export function GraphiteSettingsSection() {
  const { state, set, graphiteRepoPath } = useSettingsFormContext()
  return (
    <section>
      <SectionHeading>Graphite</SectionHeading>
      <GraphiteSection
        enabled={state.graphiteEnabled}
        onEnabledChange={(graphiteEnabled) => set({ graphiteEnabled })}
        commitDefault={state.graphiteCommit}
        onCommitDefaultChange={(graphiteCommit) => set({ graphiteCommit })}
        pushDefault={state.graphitePush}
        onPushDefaultChange={(graphitePush) => set({ graphitePush })}
        pullDefault={state.graphitePull}
        onPullDefaultChange={(graphitePull) => set({ graphitePull })}
        branchDefault={state.graphiteBranch}
        onBranchDefaultChange={(graphiteBranch) => set({ graphiteBranch })}
        repoPath={graphiteRepoPath}
      />
    </section>
  )
}

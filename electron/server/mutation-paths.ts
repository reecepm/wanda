// -----------------------------------------------------------------------------
// Mutation allowlist — RPC calls (from MCP, the tray, or paired peers) for
// these procedures broadcast `orpc:invalidate` to all clients so TanStack
// Query refetches. Keyed by FULL dotted procedure path so peers that reuse a
// method name (e.g. `tasks.resolve` is a read, `notification.resolve` is a
// write) don't collide.
//
// `satisfies Partial<Record<AppRouterProcedurePath, true>>` ties every key to
// the real router shape: rename or remove a procedure and its entry here turns
// into a compile error. See `electron/server/router-paths.ts` for the derived
// path union.
// -----------------------------------------------------------------------------

import type { AppRouterProcedurePath } from './router-paths'

export const MUTATION_PATHS = {
  'app.gitClone': true,
  'app.gitWorktreeAdd': true,
  'app.createWorktree': true,
  'app.removeWorktree': true,
  'app.createPR': true,
  'app.mergePR': true,
  'app.runArchiveScript': true,

  'settings.set': true,
  'agentConfig.set': true,
  'agentConfig.clear': true,

  'workspace.create': true,
  'workspace.update': true,
  'workspace.delete': true,
  'workspace.refreshIcon': true,
  'workspace.refreshAllIcons': true,

  'workspaceSettings.update': true,

  'pod.create': true,
  'pod.update': true,
  'pod.delete': true,
  'pod.duplicate': true,
  'pod.setWorkenv': true,
  'pod.unsetWorkenv': true,
  'pod.start': true,
  'pod.ensureStarted': true,
  'pod.ensureAllLocalStarted': true,
  'pod.stop': true,
  'pod.restart': true,
  'pod.stopAll': true,
  'pod.addTerminal': true,
  'pod.updateTerminal': true,
  'pod.removeTerminal': true,
  'pod.startTerminal': true,
  'pod.addAgent': true,
  'pod.removeAgent': true,
  'pod.addAgentSession': true,
  'pod.attachAgentSession': true,
  'pod.injectHooks': true,
  'pod.addCommand': true,
  'pod.updateCommand': true,
  'pod.removeCommand': true,
  'pod.importCommands': true,
  'pod.createTag': true,
  'pod.deleteTag': true,
  'pod.tagCommand': true,
  'pod.untagCommand': true,
  'pod.startCommand': true,
  'pod.stopCommand': true,
  'pod.restartCommand': true,
  'pod.addCommandToView': true,
  'pod.setActiveView': true,
  'pod.applyTemplate': true,

  'podItem.create': true,
  'podItem.update': true,
  'podItem.updateConfig': true,
  'podItem.delete': true,

  'view.create': true,
  'view.update': true,
  'view.delete': true,
  'view.applyTemplate': true,
  'view.ensureDefault': true,

  'workspaceView.create': true,
  'workspaceView.update': true,
  'workspaceView.delete': true,
  'workspaceView.setActiveView': true,
  'workspaceView.ensureDefault': true,

  'template.create': true,
  'template.createFromPod': true,
  'template.update': true,
  'template.delete': true,

  'git.stageFiles': true,
  'git.unstageFiles': true,
  'git.stageAll': true,
  'git.unstageAll': true,
  'git.commit': true,
  'git.push': true,
  'git.pull': true,
  'git.createBranch': true,
  'git.checkoutBranch': true,
  'git.checkoutAndPull': true,
  'git.toggleFileViewed': true,

  'graphite.create': true,
  'graphite.modify': true,
  'graphite.restack': true,
  'graphite.sync': true,
  'graphite.submit': true,
  'graphite.checkoutBranch': true,

  'docker.startContainer': true,
  'docker.stopContainer': true,
  'docker.removeContainer': true,
  'docker.removeImage': true,
  'docker.cleanupStopped': true,

  'file.write': true,

  'workenv.create': true,
  'workenv.destroy': true,
  'workenv.update': true,
  'workenv.start': true,
  'workenv.stop': true,
  'workenv.restart': true,
  'workenv.createTemplate': true,
  'workenv.updateTemplate': true,
  'workenv.deleteTemplate': true,
  'workenv.importTemplateYaml': true,
  'workenv.prebuildTemplate': true,
  'workenv.reconcile': true,

  'agent.startSession': true,
  'agent.stopSession': true,
  // agent.session.* — listed so the middleware emits `orpc:invalidate`.
  // `prompt` is included not for direct invalidation (WS events drive the
  // reducer) but because re-listing `session.list` keeps the sidebar's
  // `lastActiveAt` fresh.
  'agent.session.create': true,
  'agent.session.archive': true,
  'agent.session.unarchive': true,
  'agent.session.rename': true,
  'agent.session.prompt': true,
  'agent.session.cancel': true,
  'agent.session.setMode': true,
  'agent.session.setModel': true,
  'agent.session.setReasoningEffort': true,
  'agent.session.startReview': true,
  'agent.session.respondPermission': true,
  'agent.session.respondQuestion': true,
  'agent.session.close': true,
  'agent.attachment.upload': true,
  'agent.permissions.revokePolicy': true,

  'tasks.create': true,
  'tasks.update': true,
  'tasks.delete': true,
  'tasks.publish': true,
  'tasks.claim': true,
  'tasks.complete': true,
  'tasks.fail': true,
  'tasks.block': true,
  'tasks.unblock': true,
  'tasks.release': true,
  'tasks.renew': true,
  'tasks.createProject': true,
  'tasks.updateProject': true,
  'tasks.archiveProject': true,
  'tasks.createWorkspace': true,
  'tasks.updateWorkspace': true,
  'tasks.archiveWorkspace': true,
  'tasks.addLearning': true,
  'tasks.requestContext': true,
  'tasks.answerContext': true,
  'tasks.tick': true,

  'notification.markRead': true,
  'notification.resolve': true,
  'notification.dismissAll': true,

  'onboarding.createPresetTemplate': true,
  'onboarding.setDefaultTemplate': true,
  'onboarding.finish': true,
  'onboarding.reset': true,

  'plan.create': true,
  'plan.update': true,
  'plan.appendNote': true,
  'plan.setStatus': true,
  'plan.delete': true,
  'plan.addLink': true,
  'plan.removeLink': true,
  'plan.addComment': true,
  'plan.updateComment': true,
  'plan.removeComment': true,
  'plan.submitForReview': true,
  'plan.resolveReview': true,

  'review.getOrCreateDraft': true,
  'review.addComment': true,
  'review.updateComment': true,
  'review.removeComment': true,
  'review.submitReview': true,

  'secrets.set': true,
  'secrets.remove': true,

  'taskView.create': true,
  'taskView.update': true,
  'taskView.delete': true,
  'taskView.ensureDefaults': true,
} satisfies Partial<Record<AppRouterProcedurePath, true>>

import type { TaskStatus } from './types.ts'

export class TaskNotFoundError extends Error {
  readonly taskId: string
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`)
    this.name = 'TaskNotFoundError'
    this.taskId = taskId
  }
}

export class ProjectNotFoundError extends Error {
  readonly projectId: string
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`)
    this.name = 'ProjectNotFoundError'
    this.projectId = projectId
  }
}

export class WorkspaceNotFoundError extends Error {
  readonly workspaceId: string
  constructor(workspaceId: string) {
    super(`Workspace not found: ${workspaceId}`)
    this.name = 'WorkspaceNotFoundError'
    this.workspaceId = workspaceId
  }
}

export class VersionConflictError extends Error {
  readonly entityId: string
  readonly expected: number
  readonly actual: number
  constructor(entityId: string, expected: number, actual: number) {
    super(`Version conflict on ${entityId}: expected ${expected}, got ${actual}`)
    this.name = 'VersionConflictError'
    this.entityId = entityId
    this.expected = expected
    this.actual = actual
  }
}

export class InvalidTransitionError extends Error {
  readonly from: TaskStatus
  readonly to: TaskStatus
  constructor(from: TaskStatus, to: TaskStatus) {
    super(`Invalid status transition: ${from} → ${to}`)
    this.name = 'InvalidTransitionError'
    this.from = from
    this.to = to
  }
}

export class AlreadyClaimedError extends Error {
  readonly taskId: string
  readonly claimedBy: string
  constructor(taskId: string, claimedBy: string) {
    super(`Task ${taskId} is already claimed by ${claimedBy}`)
    this.name = 'AlreadyClaimedError'
    this.taskId = taskId
    this.claimedBy = claimedBy
  }
}

export class NotClaimedError extends Error {
  readonly taskId: string
  constructor(taskId: string) {
    super(`Task ${taskId} is not currently claimed`)
    this.name = 'NotClaimedError'
    this.taskId = taskId
  }
}

export class LeaseExpiredError extends Error {
  readonly taskId: string
  readonly expiredAt: number
  constructor(taskId: string, expiredAt: number) {
    super(`Lease on task ${taskId} expired at ${new Date(expiredAt).toISOString()}`)
    this.name = 'LeaseExpiredError'
    this.taskId = taskId
    this.expiredAt = expiredAt
  }
}

export class DependencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DependencyError'
  }
}

export class ContextRequestNotFoundError extends Error {
  readonly requestId: string
  constructor(requestId: string) {
    super(`Context request not found: ${requestId}`)
    this.name = 'ContextRequestNotFoundError'
    this.requestId = requestId
  }
}

export class PeerNotFoundError extends Error {
  readonly peerName: string
  constructor(peerName: string) {
    super(`Peer not found: ${peerName}`)
    this.name = 'PeerNotFoundError'
    this.peerName = peerName
  }
}

export class RemoteTaskError extends Error {
  readonly peerName: string
  readonly method: string
  readonly cause_: unknown
  constructor(peerName: string, method: string, cause_: unknown) {
    super(`Remote call ${method} to peer ${peerName} failed`)
    this.name = 'RemoteTaskError'
    this.peerName = peerName
    this.method = method
    this.cause_ = cause_
  }
}

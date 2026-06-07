// -----------------------------------------------------------------------------
// @wanda/agent-ui — framework components for rendering an AgentSession.
//
// Consumers:
//   1. Import the stylesheet once:   import '@wanda/agent-ui/agent-ui.css'
//   2. Install a transport via       <AgentUIProvider transport={...}>
//   3. Wire the transport's WS       subscription to store.applyLiveEvent
//   4. Render                        <ChatView sessionId />  (default layout)
//      or compose primitives         <Chat.Root> <Chat.Header/> <Chat.Stream/> … </Chat.Root>
//
// No hard-wiring to Electron — the transport interface accepts any client
// (Electron renderer, browser, Storybook stub).
// -----------------------------------------------------------------------------

export { Chat, ChatView } from './ChatView'
export {
  Composer,
  ComposerModelPicker,
  ComposerModePicker,
  ComposerReviewButton,
} from './composer/Composer'
export type {
  AgentUIContextValue,
  AgentUIProviderProps,
  AgentUITransport,
  AttachmentUploadResult,
  CreateSessionInput,
  CreateSessionOutput,
} from './context'
export {
  AgentUIProvider,
  useAgentTransport,
  useAgentUI,
  useChatStore,
} from './context'
export type { StreamingSnapshot } from './hooks/useAgentMessages'
export {
  useAgentCapabilities,
  useAgentLastError,
  useAgentMessages,
  useAgentPlan,
  useAgentSession,
  useIsWaitingOnUser,
  usePendingPermissions,
  usePendingQuestions,
  useStreamingPart,
} from './hooks/useAgentMessages'
export { MessageList } from './MessageList'
export { MessageStream } from './MessageStream'
export { MessageBubble } from './parts/Message'
export { PermissionPart } from './parts/PermissionPart'
export { PlanPart } from './parts/PlanPart'
export { QuestionPart } from './parts/QuestionPart'
export { ReasoningPart } from './parts/ReasoningPart'
export { TextPart } from './parts/TextPart'
export { asToolPart, ToolCallPart } from './parts/ToolCallPart'
export { StreamingTail } from './StreamingTail'
export { installDefaultToolRenderers } from './tools/DefaultToolRenderers'
export type { ToolPart, ToolRenderer, ToolRendererProps } from './tools/registry'
export {
  clearToolRegistry,
  registerCustomToolRenderer,
  registerToolRenderer,
  resolveToolRenderer,
} from './tools/registry'
export { CodeInk } from './ui/CodeInk'
export type { IconButtonProps } from './ui/IconButton'
export { IconButton } from './ui/IconButton'
export { Kbd } from './ui/Kbd'
export { Markdown } from './ui/Markdown'
export type { PillButtonProps } from './ui/PillButton'
export { PillButton } from './ui/PillButton'
export type { RailState } from './ui/Rail'
// ---- Primitive UI vocabulary — useful when writing a custom tool renderer
export { Rail } from './ui/Rail'
export type { SelectOption } from './ui/Select'
export { Select } from './ui/Select'
export { Shimmer, ShimmerDot } from './ui/Shimmer'
export type { ToolRowStatus } from './ui/ToolRow'
export { ToolRow } from './ui/ToolRow'
export { TurnStamp } from './ui/TurnStamp'

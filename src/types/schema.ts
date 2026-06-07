// Re-export domain types from shared/contracts for renderer use.
//
// This indirection keeps existing `import { X } from '@/types/schema'` call
// sites working while routing the underlying source through the contracts
// barrel. The contracts barrel is the single place where any renderer ↔
// electron type crossing happens.

export type {
  AgentCliFlagDefinition,
  AgentConfigPayload,
  AgentItemConfig,
  AgentSessionItemConfig,
  AgentType,
  BrowserItemConfig,
  CanvasNode,
  CanvasViewConfig,
  CanvasViewport,
  CarouselItem,
  CarouselViewConfig,
  ColumnsRow,
  ColumnsViewConfig,
  CommandItemConfig,
  CommentResolution,
  DetectedPort,
  GridViewConfig,
  GridWidget,
  MarkdownItemConfig,
  PaneTabGroup,
  PodItemConfig,
  ResolvedPort,
  Review,
  ReviewComment,
  ReviewCommentWithResolution,
  ReviewSide,
  ReviewState,
  SplitPaneViewConfig,
  TaskFilterConfig,
  TaskViewConfig,
  TerminalItemConfig,
  ViewConfig,
  ViewItem,
  ViewItemSettings,
  WorkenvConfig,
  WorkenvLayer,
  WorkenvLayerKind,
  WorkenvResolvedPort,
  WorkenvRuntime,
  WorkenvState,
} from '../../shared/contracts'

export { AGENT_CLI_FLAG_DEFINITIONS, workenvConfigSchema } from '../../shared/contracts'

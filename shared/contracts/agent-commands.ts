// -----------------------------------------------------------------------------
// Cross-boundary re-exports for `agent.session.*` and `agent.providers.*`
// oRPC I/O schemas. The router consumes these directly; the
// renderer uses the inferred TS types through TanStack Query.
// -----------------------------------------------------------------------------

export type {
  CancelSessionInput,
  CancelSessionOutput,
  CloseSessionInput,
  CloseSessionOutput,
  CreateSessionInput,
  CreateSessionOutput,
  InstalledProvider,
  PromptInput,
  PromptOutput,
  ProviderManifest,
  RespondPermissionInput,
  RespondPermissionOutput,
  RespondQuestionInput,
  RespondQuestionOutput,
  SetModeInput,
  SetModeOutput,
} from '@wanda/agent-protocol'
export {
  CancelSessionInputSchema,
  CancelSessionOutputSchema,
  CloseSessionInputSchema,
  CloseSessionOutputSchema,
  CreateSessionInputSchema,
  CreateSessionOutputSchema,
  InstalledProviderSchema,
  ListInstalledProvidersOutputSchema,
  ListProvidersOutputSchema,
  PromptInputSchema,
  PromptOutputSchema,
  ProviderManifestSchema,
  RespondPermissionInputSchema,
  RespondPermissionOutputSchema,
  RespondQuestionInputSchema,
  RespondQuestionOutputSchema,
  SetModeInputSchema,
  SetModeOutputSchema,
} from '@wanda/agent-protocol'

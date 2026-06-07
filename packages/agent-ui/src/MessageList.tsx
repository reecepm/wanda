// -----------------------------------------------------------------------------
// Back-compat re-export. `MessageList` was the previous name for the scrollable
// reading surface; it's now `MessageStream` (see MessageStream.tsx for the
// reason). Keeping the export so external consumers don't need to rewire.
// -----------------------------------------------------------------------------

export { MessageStream as MessageList } from './MessageStream'

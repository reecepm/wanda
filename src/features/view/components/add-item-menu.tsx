import { useQuery } from '@tanstack/react-query'
import { Fragment } from 'react'
import { ClaudeIcon, OpenAIIcon, OpenCodeIcon } from '@/features/icons'
import { type AddItemActions, type AgentOption, CLI_AGENT_OPTIONS } from '@/features/pod'
import {
  AGENT_MENU_CONFIG_SETTING_KEY,
  applyAgentMenuConfig,
  ITEM_MENU_ORDER_SETTING_KEY,
  orderItemMenuEntries,
  parseAgentMenuConfig,
  parseItemMenuOrder,
} from '@/features/view/utils/item-menu-order'
import { RiAddLine, RiFileTextLine, RiGlobalLine, RiRobot2Line, RiTerminalBoxLine, RiTerminalLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'

type IconComponent = React.ElementType<{ className?: string }>

const PROVIDER_ICON: Record<AgentOption['provider'], IconComponent> = {
  claude: ClaudeIcon,
  codex: OpenAIIcon,
  opencode: OpenCodeIcon,
  mock: RiRobot2Line,
}

interface AddItemMenuItemsProps {
  variant: 'dropdown' | 'context'
  actions: AddItemActions
}

interface AddItemDropdownProps {
  actions: AddItemActions
  triggerClassName?: string
  triggerTitle?: string
  showLabel?: boolean
  contentClassName?: string
  contentAlign?: React.ComponentProps<typeof DropdownMenuContent>['align']
  contentSide?: React.ComponentProps<typeof DropdownMenuContent>['side']
  contentSideOffset?: React.ComponentProps<typeof DropdownMenuContent>['sideOffset']
  contentAlignOffset?: React.ComponentProps<typeof DropdownMenuContent>['alignOffset']
}

export function AddItemDropdown({
  actions,
  triggerClassName = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors',
  triggerTitle = 'Add item',
  showLabel = true,
  contentClassName,
  contentAlign,
  contentSide,
  contentSideOffset,
  contentAlignOffset,
}: AddItemDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClassName} title={triggerTitle}>
        <RiAddLine className="h-3.5 w-3.5" />
        {showLabel ? 'Add Item' : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={contentAlign}
        alignOffset={contentAlignOffset}
        side={contentSide}
        sideOffset={contentSideOffset}
        className={contentClassName}
      >
        <AddItemMenuItems variant="dropdown" actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function EmptyAddItems({
  title,
  description = 'Add an item to get started.',
  actions,
}: {
  title: string
  description?: string
  actions: AddItemActions
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
      <RiAddLine className="h-8 w-8 text-zinc-700 mb-3" />
      <p className="text-sm text-zinc-500 mb-1">{title}</p>
      <p className="text-xs text-zinc-600 mb-4">{description}</p>
      <AddItemDropdown actions={actions} />
    </div>
  )
}

/**
 * Single "Agent" submenu — lists terminal CLIs only. Ordering and visibility
 * come from the menu settings.
 */
export function AddItemMenuItems({ variant, actions }: AddItemMenuItemsProps) {
  const Item = variant === 'dropdown' ? DropdownMenuItem : ContextMenuItem
  const Sub = variant === 'dropdown' ? DropdownMenuSub : ContextMenuSub
  const SubTrigger = variant === 'dropdown' ? DropdownMenuSubTrigger : ContextMenuSubTrigger
  const SubContent = variant === 'dropdown' ? DropdownMenuSubContent : ContextMenuSubContent
  const Separator = variant === 'dropdown' ? DropdownMenuSeparator : ContextMenuSeparator

  const { data: savedOrder } = useQuery(
    orpcUtils.settings.get.queryOptions({ input: { key: ITEM_MENU_ORDER_SETTING_KEY } }),
  )
  const { data: savedAgentConfig } = useQuery(
    orpcUtils.settings.get.queryOptions({ input: { key: AGENT_MENU_CONFIG_SETTING_KEY } }),
  )
  const configuredOrder = parseItemMenuOrder(savedOrder)
  const agentOptions = applyAgentMenuConfig(CLI_AGENT_OPTIONS, parseAgentMenuConfig(savedAgentConfig))

  const runOption = async (opt: AgentOption) => {
    if (opt.disabled) return
    if (opt.cliAgentType) {
      await actions.addAgent(opt.cliAgentType)
    }
  }

  const entries = orderItemMenuEntries(
    [
      {
        id: 'agent',
        node: (
          <Sub>
            <SubTrigger>
              <RiRobot2Line />
              Agent
            </SubTrigger>
            <SubContent>
              {agentOptions.map((opt, index) => {
                const Icon = PROVIDER_ICON[opt.provider]
                const previous = agentOptions[index - 1]
                return (
                  <Fragment key={opt.id}>
                    {previous && previous.kind !== opt.kind && <Separator />}
                    <Item onClick={() => void runOption(opt)} disabled={opt.disabled}>
                      <span className="relative inline-flex size-3.5 items-center justify-center">
                        <Icon className="size-3.5" />
                      </span>
                      {opt.label}
                      <RiTerminalLine className="ml-auto size-3 opacity-60" />
                      {opt.disabled && (
                        <span className="ml-auto text-[10px] opacity-70">{opt.statusDetail ?? 'Unavailable'}</span>
                      )}
                    </Item>
                  </Fragment>
                )
              })}
            </SubContent>
          </Sub>
        ),
      },
      {
        id: 'terminal',
        node: (
          <Item onClick={() => actions.addTerminal()}>
            <RiTerminalLine />
            Terminal
          </Item>
        ),
      },
      {
        id: 'command',
        node: (
          <Sub>
            <SubTrigger>
              <RiTerminalBoxLine />
              Command
            </SubTrigger>
            <SubContent>
              {actions.commandsNotInView.map((cmd) => (
                <Item key={cmd.id} onClick={() => actions.addCommand(cmd.id)}>
                  {cmd.name}
                </Item>
              ))}
              {actions.commandsNotInView.length > 0 && <Separator />}
              <Item onClick={() => actions.newCommand()}>New Command...</Item>
            </SubContent>
          </Sub>
        ),
      },
      {
        id: 'browser',
        node: (
          <Item onClick={() => actions.addBrowser()}>
            <RiGlobalLine />
            Browser
          </Item>
        ),
      },
      {
        id: 'markdown',
        node: (
          <Item onClick={() => actions.addMarkdown()}>
            <RiFileTextLine />
            Markdown File...
          </Item>
        ),
      },
    ],
    configuredOrder,
  )

  return (
    <>
      {entries.map((entry) => (
        <Fragment key={entry.id}>{entry.node}</Fragment>
      ))}
    </>
  )
}

import { z } from 'zod'

const splitNodeSchema: z.ZodType<import('../../../../src/features/view/utils/split-tree').SplitNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('leaf'), itemId: z.string() }),
    z.object({
      type: z.literal('branch'),
      direction: z.enum(['horizontal', 'vertical']),
      children: z.tuple([splitNodeSchema, splitNodeSchema]),
      sizes: z.tuple([z.number(), z.number()]),
    }),
  ]),
)

const paneTabGroupSchema = z.object({
  tabIds: z.array(z.string()),
  activeTabId: z.string().nullable(),
})

export const viewConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tabs'), focusedItemId: z.string().optional() }),
  z.object({
    type: z.literal('split-pane'),
    layout: splitNodeSchema,
    paneTabs: z.record(z.string(), paneTabGroupSchema).optional(),
    focusedItemId: z.string().optional(),
  }),
  z.object({
    type: z.literal('grid'),
    widgets: z.array(z.object({ itemId: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() })),
    columns: z.number().optional(),
    rowHeight: z.number().optional(),
    focusedItemId: z.string().optional(),
  }),
  z.object({
    type: z.literal('carousel'),
    items: z.array(z.object({ itemId: z.string(), width: z.number() })),
    focusedItemId: z.string().optional(),
  }),
  z.object({
    type: z.literal('columns'),
    rows: z.array(z.object({ items: z.array(z.object({ itemId: z.string(), width: z.number() })) })),
    focusedItemId: z.string().optional(),
  }),
  z.object({
    type: z.literal('canvas'),
    nodes: z.array(
      z.object({ itemId: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
    ),
    viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
    focusedItemId: z.string().optional(),
  }),
])

export const viewItemSettingsSchema = z.object({
  sortOrder: z.number(),
  pinned: z.boolean().optional(),
})

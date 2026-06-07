import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { PodCreateDialog } from './pod-create-dialog'

const meta = {
  title: 'WorkspaceExplorer/PodCreateDialog',
  component: PodCreateDialog,
  args: {
    onSubmit: fn(),
    onCancel: fn(),
    workspaceDefaults: {
      cwd: '/Users/example/projects/my-app',
    },
  },
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof PodCreateDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Simple: Story = {}

export const WithTemplateDefault: Story = {
  args: {
    workspaceDefaults: {
      cwd: '/Users/example/projects/my-app',
      defaultTemplatePodId: 'tpl-1',
    },
  },
}

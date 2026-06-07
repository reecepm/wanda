import type { Project, TaskType } from '@wanda/tasks'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'

interface TaskCreateDialogProps {
  projectId?: string
  projects?: Project[]
  onSubmit: (data: {
    projectId?: string
    title: string
    description?: string
    content?: string
    type?: TaskType
    priority?: number
    dependsOn?: string[]
    labels?: Record<string, string>
  }) => void
  onCancel: () => void
}

export function TaskCreateDialog({ projectId, projects = [], onSubmit, onCancel }: TaskCreateDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? projects[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [type, setType] = useState<TaskType>('task')
  const [priority, setPriority] = useState('0')
  const [dependsOn, setDependsOn] = useState('')
  const [labels, setLabels] = useState('')

  const canSubmit = title.trim() !== ''

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    onSubmit({
      projectId: selectedProjectId || undefined,
      title: title.trim(),
      description: description.trim() || undefined,
      content: content.trim() || undefined,
      type,
      priority: priority ? Number(priority) : undefined,
      dependsOn: dependsOn.trim() ? dependsOn.split(',').map((s) => s.trim()) : undefined,
      labels: labels.trim()
        ? Object.fromEntries(
            labels.split(',').map((s) => {
              const [k = '', ...rest] = s.trim().split(':')
              return [k.trim(), rest.join(':').trim() || '']
            }),
          )
        : undefined,
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent className="sm:max-w-[420px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {projects.length > 0 && (
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Project *</label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
              >
                <option value="">Select project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Title *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description"
              rows={2}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500 resize-none"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Detailed content (markdown)"
              rows={3}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500 resize-none font-mono"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-zinc-400 mb-1 block">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as TaskType)}
                className="w-full h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
              >
                <option value="task">Task</option>
                <option value="epic">Epic</option>
                <option value="milestone">Milestone</option>
                <option value="subtask">Subtask</option>
              </select>
            </div>
            <div className="w-20">
              <label className="text-xs text-zinc-400 mb-1 block">Priority</label>
              <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} min="0" max="10" />
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Depends On</label>
            <Input
              value={dependsOn}
              onChange={(e) => setDependsOn(e.target.value)}
              placeholder="Comma-separated task IDs"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Labels</label>
            <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="key:value, key:value" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

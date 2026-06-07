import { RiErrorWarningLine } from '@/lib/icons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'

interface ConflictDialogProps {
  open: boolean
  fileName: string
  onKeepMine: () => void
  onDiscardMine: () => void
  onOpenChange: (open: boolean) => void
}

/**
 * Prompted when the user tries to save a file that has been modified externally
 * since they started editing. Offers the two non-destructive options we settled
 * on for v1: keep-mine (overwrite) or discard-mine (reload).
 */
export function ConflictDialog({ open, fileName, onKeepMine, onDiscardMine, onOpenChange }: ConflictDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <RiErrorWarningLine className="h-4 w-4 text-amber-500" />
            File changed on disk
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono text-zinc-300">{fileName}</span> has been modified outside of Wanda since you
            started editing. Your unsaved changes still exist in this editor.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              onDiscardMine()
            }}
            className="bg-zinc-700 hover:bg-zinc-600"
          >
            Discard mine and reload
          </AlertDialogAction>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              onKeepMine()
            }}
          >
            Keep mine and overwrite
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

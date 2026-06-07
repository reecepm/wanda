import type React from 'react'

export type FilterField = 'status' | 'type' | 'priority' | 'assignable' | 'origin' | 'project' | 'labels'

export type FilterOperator = 'is' | 'is not' | 'is any of' | 'is none of'

export interface ActiveFilter {
  id: string
  field: FilterField
  operator: FilterOperator
  values: string[]
}

export interface FilterFieldConfig {
  field: FilterField
  label: string
  icon: React.ComponentType<{ className?: string }>
  options: FilterOption[]
  multi?: boolean
}

export interface FilterOption {
  value: string
  label: string
  icon?: React.ReactNode
}

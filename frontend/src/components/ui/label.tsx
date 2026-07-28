import type { LabelHTMLAttributes } from 'react'

import { labelClasses } from '@/components/ui/label-variants'

type LabelProps = LabelHTMLAttributes<HTMLLabelElement>

export function Label({ className, ...props }: LabelProps) {
  return <label className={labelClasses(className)} {...props} />
}

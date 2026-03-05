"use client"

import { Skeleton } from "@/components/ui/skeleton"
import {
  TableCell,
  TableRow,
} from "@/components/ui/table"

interface TableSkeletonProps {
  rows?: number
  cols?: number
}

// renders only body rows; the table header should be defined separately by the caller
export function TableSkeleton({ rows = 5, cols = 4 }: TableSkeletonProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <TableRow key={rowIndex} className="border-white/5">
          {Array.from({ length: cols }).map((_, colIndex) => (
            <TableCell key={colIndex} className="py-4 px-4">
              <Skeleton
                className="h-4 bg-white/10"
                style={{ width: colIndex === cols - 1 ? 40 : `${70 + (colIndex * 10)}%` }}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

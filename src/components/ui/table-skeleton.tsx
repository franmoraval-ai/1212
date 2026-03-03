"use client"

import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface TableSkeletonProps {
  rows?: number
  cols?: number
}

export function TableSkeleton({ rows = 5, cols = 4 }: TableSkeletonProps) {
  return (
    <Table>
      <TableHeader className="border-none">
        <TableRow className="hover:bg-transparent border-none">
          {Array.from({ length: cols }).map((_, i) => (
            <TableHead key={i} className="py-4 px-4">
              <Skeleton className="h-4 w-24 bg-white/10" />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
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
      </TableBody>
    </Table>
  )
}

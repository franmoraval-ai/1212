type QueryFilter =
  | { type: "eq"; column: string; value: unknown }
  | { type: "in"; column: string; values: unknown[] }
  | { type: "ilike"; column: string; value: unknown }

type QueryState = {
  table: string
  select?: string
  filters: QueryFilter[]
  limit?: number
  maybeSingle?: boolean
}

type QueryResult = {
  data?: unknown
  error?: { message?: string } | null
}

type Resolver = (query: QueryState) => QueryResult | Promise<QueryResult>

function buildResult(result: QueryResult, maybeSingle = false) {
  if (!maybeSingle) {
    return {
      data: result.data ?? null,
      error: result.error ?? null,
    }
  }

  const single = Array.isArray(result.data) ? (result.data[0] ?? null) : (result.data ?? null)
  return {
    data: single,
    error: result.error ?? null,
  }
}

function createQueryBuilder(table: string, resolver: Resolver) {
  const state: QueryState = {
    table,
    filters: [],
  }

  const builder = {
    select(selection: string) {
      state.select = selection
      return builder
    },
    eq(column: string, value: unknown) {
      state.filters.push({ type: "eq", column, value })
      return builder
    },
    in(column: string, values: unknown[]) {
      state.filters.push({ type: "in", column, values })
      return builder
    },
    ilike(column: string, value: unknown) {
      state.filters.push({ type: "ilike", column, value })
      return builder
    },
    limit(value: number) {
      state.limit = value
      return builder
    },
    maybeSingle() {
      state.maybeSingle = true
      return Promise.resolve(resolver({ ...state, filters: [...state.filters] })).then((result) => buildResult(result, true))
    },
    then(onFulfilled?: (value: { data: unknown; error: { message?: string } | null }) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise
        .resolve(resolver({ ...state, filters: [...state.filters] }))
        .then((result) => buildResult(result, false))
        .then(onFulfilled, onRejected)
    },
  }

  return builder
}

export function createSupabaseAdminStub(resolver: Resolver) {
  return {
    from(table: string) {
      return createQueryBuilder(table, resolver)
    },
  }
}

export function getEqFilter(query: QueryState, column: string) {
  return query.filters.find((filter) => filter.type === "eq" && filter.column === column)
}

export function getInFilter(query: QueryState, column: string) {
  return query.filters.find((filter) => filter.type === "in" && filter.column === column)
}

export type { QueryState }
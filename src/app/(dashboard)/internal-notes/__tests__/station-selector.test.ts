import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("Novedades station selector", () => {
  it("selects an authorized operation before filtering its stations", async () => {
    const page = await readFile(
      "src/app/(dashboard)/internal-notes/page.tsx",
      "utf8"
    )

    expect(page).toContain('useOperationCatalogData()')
    expect(page).toContain('operation.isActive !== false')
    expect(page).toContain('<SelectValue placeholder={isLoadingOperations ? "Cargando operaciones..." : "Seleccione una operación"}')
    expect(page).toContain('setPostName("")')
    expect(page).toContain('.filter((operation) => operation.operationName === operationName)')
    expect(page).toContain('<Select value={postName} onValueChange={setPostName}')
    expect(page).toContain('Seleccione primero una operación')
    expect(page).toContain('No hay puestos activos asignados a este usuario.')
  })

  it("keeps the active station fixed during station mode", async () => {
    const page = await readFile(
      "src/app/(dashboard)/internal-notes/page.tsx",
      "utf8"
    )

    expect(page).toContain('stationModeEnabled ? stationPostName : postName')
    expect(page).toContain('stationModeEnabled ? stationOperationName : operationName')
    expect(page).toMatch(/stationModeEnabled \? \([\s\S]*?<Input[\s\S]*?disabled/)
  })
})
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("Novedades station selector", () => {
  it("uses the authorized operation catalog outside station mode", async () => {
    const page = await readFile(
      "src/app/(dashboard)/internal-notes/page.tsx",
      "utf8"
    )

    expect(page).toContain('useOperationCatalogData()')
    expect(page).toContain('operation.isActive === false')
    expect(page).toContain('<Select value={postName} onValueChange={setPostName}')
    expect(page).toContain('Seleccione un puesto')
    expect(page).toContain('No hay puestos activos asignados a este usuario.')
  })

  it("keeps the active station fixed during station mode", async () => {
    const page = await readFile(
      "src/app/(dashboard)/internal-notes/page.tsx",
      "utf8"
    )

    expect(page).toContain('stationModeEnabled ? stationPostName : postName')
    expect(page).toMatch(/stationModeEnabled \? \([\s\S]*?<Input[\s\S]*?disabled/)
  })
})
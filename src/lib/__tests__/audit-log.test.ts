import { describe, expect, it } from "vitest"
import { sanitizeAuditMetadata, writeAuditEvent } from "@/lib/audit-log"

const actor = {
  uid: "auth-director",
  userId: "director-1",
  email: "director@demo.test",
  firstName: "Directora",
  status: "Activo",
  assigned: null,
  roleLevel: 4,
  customPermissions: [],
}

describe("audit log", () => {
  it("removes secrets from audit metadata", () => {
    expect(sanitizeAuditMetadata({
      status: "Activo",
      temporaryPassword: "do-not-log",
      nested: { shiftPin: "1234", assigned: "Puesto Norte" },
    })).toEqual({
      status: "Activo",
      nested: { assigned: "Puesto Norte" },
    })
  })

  it("records successful events with the acting identity", async () => {
    const inserts: unknown[] = []
    const admin = {
      from(table: string) {
        expect(table).toBe("audit_events")
        return {
          insert(values: unknown) {
            inserts.push(values)
            return Promise.resolve({ error: null })
          },
        }
      },
    }

    await expect(writeAuditEvent(admin as never, actor, {
      action: "personnel.user.updated",
      resourceType: "user",
      resourceId: "officer-1",
      metadata: { status: "Inactivo" },
    }, new Request("http://localhost/api/personnel/users"))).resolves.toBe(true)

    expect(inserts).toEqual([
      expect.objectContaining({
        actor_user_id: "director-1",
        actor_email: "director@demo.test",
        action: "personnel.user.updated",
        resource_type: "user",
        resource_id: "officer-1",
        source_path: "/api/personnel/users",
      }),
    ])
  })

  it("does not interrupt an operation when the audit table is unavailable", async () => {
    const admin = {
      from() {
        return {
          insert() {
            return Promise.resolve({ error: { message: "relation audit_events does not exist" } })
          },
        }
      },
    }

    await expect(writeAuditEvent(admin as never, actor, {
      action: "personnel.user.deleted",
      resourceType: "user",
      resourceId: "officer-1",
    })).resolves.toBe(false)
  })
})
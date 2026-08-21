import { describe, expect, it } from "vitest"
import { createEmptyManagedTeamScope } from "@/lib/manager-hierarchy"
import { canViewSupervisionRecord } from "@/lib/supervision-visibility"

const emptyTeam = createEmptyManagedTeamScope()

function actor(roleLevel: number, userId: string) {
  return {
    uid: `auth-${userId}`,
    userId,
    email: `${userId}@demo.test`,
    roleLevel,
  }
}

describe("canViewSupervisionRecord", () => {
  it("allows L2 to see only their own supervisions", () => {
    const l2 = actor(2, "l2-one")
    const scopes = ["BCR | Casa Pavas"]

    expect(canViewSupervisionRecord(l2, emptyTeam, {
      supervisor_id: "l2-one",
      operation_name: "BCR",
      review_post: "Casa Pavas",
    }, scopes)).toBe(true)

    expect(canViewSupervisionRecord(l2, emptyTeam, {
      supervisor_id: "other-l2",
      operation_name: "BCR",
      review_post: "Casa Pavas",
    }, scopes)).toBe(false)
  })

  it("allows L3 to see L2, L3, and L4 records only in operations under command", () => {
    const l3 = actor(3, "l3-one")
    const scopes = ["BCR | Casa Pavas"]

    for (const supervisorId of ["l2-other", "l3-other", "l4-director"]) {
      expect(canViewSupervisionRecord(l3, emptyTeam, {
        supervisor_id: supervisorId,
        operation_name: "BCR",
        review_post: "Casa Pavas",
      }, scopes)).toBe(true)
    }

    expect(canViewSupervisionRecord(l3, emptyTeam, {
      supervisor_id: "l3-one",
      operation_name: "INS",
      review_post: "Heredia",
    }, scopes)).toBe(false)
  })

  it("allows L4 to see every supervision", () => {
    expect(canViewSupervisionRecord(actor(4, "l4-one"), emptyTeam, {
      supervisor_id: "other",
      operation_name: "INS",
      review_post: "Heredia",
    }, [])).toBe(true)
  })
})

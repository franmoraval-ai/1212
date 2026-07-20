import { describe, expect, it } from "vitest"
import { canAlertOfficer } from "../push-authorization"
import type { ManagedTeamScope } from "../manager-hierarchy"

function emptyScope(): ManagedTeamScope {
  return { userIds: new Set<string>(), emails: new Set<string>() }
}

const baseActor = {
  uid: "actor-uid",
  userId: "actor-id",
  email: "sup@hoseguridad.com",
  assigned: "FARMAVALUE | FARMACIAS",
}

const officer = {
  id: "officer-1",
  email: "officer1@hoseguridad.com",
  assigned: "FARMAVALUE | FARMACIAS",
}

describe("canAlertOfficer", () => {
  it("lets L4 alert anyone", () => {
    expect(canAlertOfficer({ ...baseActor, roleLevel: 4, assigned: null }, emptyScope(), officer)).toBe(true)
  })

  it("never lets L1 alert", () => {
    expect(canAlertOfficer({ ...baseActor, roleLevel: 1 }, emptyScope(), officer)).toBe(false)
  })

  it("lets L3 alert an officer in their managed team", () => {
    const scope: ManagedTeamScope = { userIds: new Set(["officer-1"]), emails: new Set() }
    expect(canAlertOfficer({ ...baseActor, roleLevel: 3 }, scope, officer)).toBe(true)
  })

  it("blocks L3 from alerting an officer outside their team", () => {
    expect(canAlertOfficer({ ...baseActor, roleLevel: 3 }, emptyScope(), officer)).toBe(false)
  })

  it("lets L2 alert an officer in the same assigned station", () => {
    expect(canAlertOfficer({ ...baseActor, roleLevel: 2 }, emptyScope(), officer)).toBe(true)
  })

  it("blocks L2 from alerting an officer in a different station", () => {
    const otherStation = { ...officer, assigned: "BANCO CENTRAL | BANCOS" }
    expect(canAlertOfficer({ ...baseActor, roleLevel: 2 }, emptyScope(), otherStation)).toBe(false)
  })
})

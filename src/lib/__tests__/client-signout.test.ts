import { beforeEach, describe, expect, it } from "vitest"
import { clearOperationalBrowserStorage } from "@/lib/client-signout"

describe("clearOperationalBrowserStorage", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("removes operational data while preserving the active auth handoff", () => {
    window.localStorage.setItem("ho_auth_session_backup_v1", "session")
    window.localStorage.setItem("ho_auth_user_cache_v1", "profile")
    window.localStorage.setItem("ho_offline_mutation_queue_v1", "sensitive queue")
    window.localStorage.setItem("ho_station_shift_v1", "station state")
    window.localStorage.setItem("unrelated_app_setting", "keep")

    clearOperationalBrowserStorage(window.localStorage)

    expect(window.localStorage.getItem("ho_auth_session_backup_v1")).toBe("session")
    expect(window.localStorage.getItem("ho_auth_user_cache_v1")).toBe("profile")
    expect(window.localStorage.getItem("ho_offline_mutation_queue_v1")).toBeNull()
    expect(window.localStorage.getItem("ho_station_shift_v1")).toBeNull()
    expect(window.localStorage.getItem("unrelated_app_setting")).toBe("keep")
  })
})
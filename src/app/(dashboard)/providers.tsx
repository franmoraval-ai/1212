"use client"

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { Breadcrumbs } from "@/components/layout/breadcrumbs"
import { HeaderActions } from "@/components/layout/header-actions"
import { QuickActionsFab } from "@/components/layout/quick-actions-fab"
import { StationShiftBadge, StationShiftProvider } from "@/components/layout/station-shift-provider"
import { AiAssistant } from "@/components/ui/ai-assistant"
import { DashboardAuthWrapper } from "@/components/layout/dashboard-auth-wrapper"
import { useUser } from "@/supabase"
import { Star } from "lucide-react"
import { ReactNode } from "react"

export function DashboardProviders({ children }: { children: ReactNode }) {
  const { user } = useUser()

  return (
    <DashboardAuthWrapper>
      <StationShiftProvider>
        <SidebarProvider defaultOpen={true}>
          <AppSidebar />
          <SidebarInset className="bg-[#030303] overflow-x-hidden">
            <header className="flex h-14 md:h-16 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-white/5 px-4 md:px-6 sticky top-0 bg-[#030303]/90 backdrop-blur-xl z-40">
              <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden md:gap-4">
                <SidebarTrigger className="text-white hover:bg-white/10 shrink-0" />
                <div className="hidden min-w-0 md:block">
                  <Breadcrumbs />
                </div>
                <div className="flex items-center gap-2 md:gap-3 shrink-0">
                  <div className="bg-primary p-1 md:p-1.5 rounded">
                    <Star className="w-3 h-3 md:w-4 md:h-4 text-black fill-black" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-black text-xs uppercase tracking-tighter text-white italic truncate max-w-[120px] sm:max-w-none">HO SEGURIDAD</span>
                    <div className="flex items-center">
                      <span className="badge-nivel-4 text-[8px]">NIVEL {user?.roleLevel ?? 1}</span>
                    </div>
                  </div>
                </div>
                <StationShiftBadge />
              </div>
              <div className="shrink-0">
                <HeaderActions />
              </div>
            </header>
            <div className="relative flex-1 overflow-y-auto overflow-x-hidden bg-[#030303]">
              {children}
            </div>
            <QuickActionsFab />
            <AiAssistant />
          </SidebarInset>
        </SidebarProvider>
      </StationShiftProvider>
    </DashboardAuthWrapper>
  )
}

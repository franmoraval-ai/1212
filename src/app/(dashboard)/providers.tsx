"use client"

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { Breadcrumbs } from "@/components/layout/breadcrumbs"
import { HeaderActions } from "@/components/layout/header-actions"
import { DashboardAuthWrapper } from "@/components/layout/dashboard-auth-wrapper"
import { Star } from "lucide-react"
import { ReactNode } from "react"

export function DashboardProviders({ children }: { children: ReactNode }) {
  return (
    <DashboardAuthWrapper>
      <SidebarProvider defaultOpen={true}>
        <AppSidebar />
        <SidebarInset className="bg-[#030303]">
          <header className="flex h-14 md:h-16 shrink-0 items-center justify-between gap-2 border-b border-white/5 px-4 md:px-6 sticky top-0 bg-[#030303]/90 backdrop-blur-xl z-40">
            <div className="flex items-center gap-3 md:gap-4 min-w-0">
              <SidebarTrigger className="text-white hover:bg-white/10 shrink-0" />
              <Breadcrumbs />
              <div className="flex items-center gap-2 md:gap-3 shrink-0">
                <div className="bg-primary p-1 md:p-1.5 rounded">
                  <Star className="w-3 h-3 md:w-4 md:h-4 text-black fill-black" />
                </div>
                <div className="flex flex-col">
                  <span className="font-black text-[10px] md:text-xs uppercase tracking-tighter text-white italic truncate max-w-[80px] md:max-w-none">HO SEGURIDAD</span>
                  <div className="flex items-center">
                    <span className="badge-nivel-4 text-[7px] md:text-[8px]">NIVEL 4</span>
                  </div>
                </div>
              </div>
            </div>
            <HeaderActions />
          </header>
          <div className="flex-1 overflow-auto relative bg-[#030303]">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </DashboardAuthWrapper>
  )
}

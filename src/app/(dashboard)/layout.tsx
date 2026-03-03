import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { Star, Bell, Settings } from "lucide-react"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar />
      <SidebarInset className="bg-[#030303]">
        <header className="flex h-14 md:h-16 shrink-0 items-center justify-between gap-2 border-b border-white/5 px-4 md:px-6 sticky top-0 bg-[#030303]/90 backdrop-blur-xl z-40">
          <div className="flex items-center gap-3 md:gap-4">
            <SidebarTrigger className="text-white hover:bg-white/10" />
            <div className="flex items-center gap-2 md:gap-3">
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
          <div className="flex items-center gap-2 md:gap-6">
            <button className="relative group p-1.5 md:p-2 hover:bg-white/5 rounded-full transition-colors">
              <Bell className="w-4 h-4 md:w-5 md:h-5 text-muted-foreground group-hover:text-primary transition-all" />
              <span className="absolute top-1 right-1 md:top-2 md:right-2 w-2 h-2 md:w-2 bg-primary rounded-full border-2 border-[#030303]" />
            </button>
            <div className="h-6 w-px bg-white/10 hidden md:block" />
            <div className="flex items-center gap-2 md:gap-3 group cursor-pointer">
              <div className="h-8 w-8 md:h-10 md:w-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10 group-hover:border-primary/50 transition-all overflow-hidden">
                <Settings className="w-3.5 h-3.5 md:w-4 md:h-4 text-muted-foreground group-hover:text-primary group-hover:rotate-90 transition-all duration-500" />
              </div>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto relative bg-[#030303]">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

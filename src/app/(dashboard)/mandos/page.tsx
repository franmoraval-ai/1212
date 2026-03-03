
"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  Search, 
  FileSpreadsheet, 
  Download, 
  Building2, 
  MapPin, 
  Filter,
  MoreVertical,
  PlusCircle,
  Loader2
} from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useFirestore, useCollection, useMemoFirebase, useUser } from "@/firebase"
import { collection, query, orderBy } from "firebase/firestore"
import { exportToExcel, exportToPdf } from "@/lib/export-utils"
import { useToast } from "@/hooks/use-toast"

export default function MandoYControlPage() {
  const [searchTerm, setSearchTerm] = useState("")
  const [filterType, setFilterType] = useState("TODOS")
  const db = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()

  const operationsRef = useMemoFirebase(() => {
    if (!db || !user) return null
    return query(collection(db, "rounds"), orderBy("name", "asc"))
  }, [db, user])

  const { data: operations, isLoading } = useCollection(operationsRef)

  const handleExportTotal = async () => {
    const rows = (operations || []).map((op) => ({
      name: op.name || "—",
      post: op.post || "—",
      status: op.status || "—",
      frequency: op.frequency || "—",
    }))
    const result = await exportToExcel(rows, "Mando y Control - HO", [
      { header: "OPERACIÓN", key: "name", width: 30 },
      { header: "PUESTO", key: "post", width: 30 },
      { header: "ESTADO", key: "status", width: 15 },
      { header: "FRECUENCIA", key: "frequency", width: 20 },
    ], "HO_MANDO_CONTROL")
    if (result.ok) toast({ title: "Excel descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportPdf = () => {
    const rows = (operations || []).map((op) => [
      (op.name || "—").slice(0, 28),
      (op.post || "—").slice(0, 25),
      op.status || "—",
      op.frequency || "—",
    ])
    const result = exportToPdf("MANDO Y CONTROL", ["OPERACIÓN", "PUESTO", "ESTADO", "FRECUENCIA"], rows, "HO_MANDO_CONTROL")
    if (result.ok) toast({ title: "PDF descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-6 bg-primary" />
            <h1 className="text-4xl font-black tracking-tighter uppercase text-white italic glow-text">
              MANDO Y CONTROL
            </h1>
          </div>
          <p className="text-muted-foreground text-sm font-bold uppercase tracking-widest opacity-60">
            ADMINISTRACIÓN CENTRAL DE OPERACIONES
          </p>
        </div>

        <div className="flex gap-2">
          <Button 
            onClick={handleExportTotal}
            className="bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-widest px-6 h-12 shadow-[0_0_20px_rgba(22,163,74,0.3)] gap-2"
          >
            <FileSpreadsheet className="w-5 h-5" />
            EXCEL
          </Button>
          <Button 
            variant="outline"
            onClick={handleExportPdf}
            className="border-white/20 text-white hover:bg-white/10 font-black uppercase tracking-widest px-6 h-12 gap-2"
          >
            <Download className="w-5 h-5" />
            PDF
          </Button>
        </div>
      </div>

      <Card className="bg-[#111111] border-white/5">
        <CardContent className="p-6 md:p-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="BUSCAR OPERACIÓN O PUESTO..." 
                className="pl-10 bg-black/40 border-white/10 h-11 uppercase font-bold text-xs"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="bg-black/40 border-white/10 h-11 font-bold text-xs uppercase">
                <SelectValue placeholder="FILTRAR POR" />
              </SelectTrigger>
              <SelectContent className="bg-[#111111] border-white/10 text-white font-bold uppercase text-xs">
                <SelectItem value="TODOS">MOSTRAR TODOS</SelectItem>
                <SelectItem value="PUESTO">POR PUESTO</SelectItem>
                <SelectItem value="OPERACION">POR OPERACIÓN</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="flex-1 bg-black/40 border-white/10 h-11 text-xs font-bold uppercase">
                <Filter className="w-4 h-4 mr-2" />
                FILTROS
              </Button>
              <Button className="bg-[#F59E0B] text-black h-11 px-3">
                <PlusCircle className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full h-64 flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-[#F59E0B]" />
          </div>
        ) : operations?.map((op) => (
          <Card key={op.id} className="bg-[#111111] border-white/5 hover:border-[#F59E0B]/30 transition-all group">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 p-6">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
                    <Building2 className="w-4 h-4 text-[#F59E0B]" />
                  </div>
                  <CardTitle className="text-sm font-black uppercase tracking-tight italic text-white group-hover:text-[#F59E0B] transition-colors">
                    {op.name}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  <span className="text-[10px] font-bold uppercase">{op.post}</span>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-[#111111] border-white/10 text-white font-bold uppercase text-xs">
                  <DropdownMenuItem className="flex items-center gap-2">
                    <Download className="w-4 h-4" /> DESCARGAR REPORTE
                  </DropdownMenuItem>
                  <DropdownMenuItem className="flex items-center gap-2 text-green-500">
                    <FileSpreadsheet className="w-4 h-4" /> EXCEL OPERATIVO
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent className="px-6 pb-6 pt-0">
              <div className="flex items-center justify-between p-3 bg-black/40 rounded border border-white/5">
                <div className="flex flex-col">
                  <span className="text-[9px] font-black text-muted-foreground uppercase">ESTADO</span>
                  <span className={`text-[10px] font-black uppercase ${op.status === 'Activa' ? 'text-green-500' : 'text-red-500'}`}>
                    {op.status}
                  </span>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-[9px] font-black text-muted-foreground uppercase">FRECUENCIA</span>
                  <span className="text-[10px] font-black uppercase text-white">{op.frequency}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

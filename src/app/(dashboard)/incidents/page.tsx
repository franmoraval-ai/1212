"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { 
  CirclePlus,
  Loader2,
  ShieldAlert,
  Trash2
} from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { prioritizeIncident } from "@/ai/flows/ai-incident-prioritization"
import { useToast } from "@/hooks/use-toast"
import { useFirestore, useCollection, useMemoFirebase, useUser } from "@/firebase"
import { collection, addDoc, deleteDoc, doc, serverTimestamp, query, orderBy } from "firebase/firestore"
import { errorEmitter } from "@/firebase/error-emitter"
import { FirestorePermissionError } from "@/firebase/errors"

export default function IncidentsPage() {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [description, setDescription] = useState("")
  const [type, setType] = useState("")
  const [location, setLocation] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const { toast } = useToast()
  const db = useFirestore()
  const { user, isUserLoading } = useUser()

  const incidentsRef = useMemoFirebase(() => {
    if (!db || !user) return null
    return query(collection(db, "incidents"), orderBy("time", "desc"))
  }, [db, user])

  const { data: incidents, isLoading: loading } = useCollection(incidentsRef)

  const handleAnalyzeAndSave = async () => {
    if (!description || !type || !location || !db) {
      toast({
        title: "Error de Validación",
        description: "Por favor complete los campos requeridos.",
        variant: "destructive"
      })
      return
    }

    setIsAnalyzing(true)
    try {
      const result = await prioritizeIncident({
        description,
        incidentType: type,
        location,
        time: new Date().toLocaleString(),
      })
      
      const newIncident = {
        description,
        incidentType: type,
        location,
        time: serverTimestamp(),
        priorityLevel: result.priorityLevel,
        reasoning: result.reasoning,
        reportedBy: "SISTEMA TÁCTICO"
      }

      addDoc(collection(db, "incidents"), newIncident)
        .catch(async (e) => {
          const error = new FirestorePermissionError({
            path: "incidents",
            operation: "create",
            requestResourceData: newIncident
          })
          errorEmitter.emit("permission-error", error)
        })

      toast({
        title: `Prioridad Sugerida: ${result.priorityLevel}`,
        description: "El incidente ha sido registrado y priorizado por IA.",
      })
      
      setIsOpen(false)
      setDescription("")
      setType("")
      setLocation("")
    } catch (error) {
      toast({
        title: "Error de IA",
        description: "No se pudo procesar la priorización táctica.",
        variant: "destructive"
      })
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleDelete = (id: string) => {
    if (!db) return
    deleteDoc(doc(db, "incidents", id))
      .catch(async () => {
        const error = new FirestorePermissionError({
          path: `incidents/${id}`,
          operation: "delete"
        })
        errorEmitter.emit("permission-error", error)
      })
  }

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 space-y-6 md:space-y-10 animate-in fade-in duration-500 relative min-h-screen max-w-7xl mx-auto">
      <div className="scanline" />
      
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">
            AUDITORÍA DE INCIDENTES
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm font-medium tracking-tight opacity-70">
            Historial de novedades con análisis IA.
          </p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="w-full md:w-auto bg-primary hover:bg-primary/90 text-black font-black uppercase text-xs h-12 px-6 gap-2 rounded-md shadow-[0_0_20px_rgba(250,204,21,0.25)]">
              <CirclePlus className="w-5 h-5 stroke-[3px]" />
              NUEVO REPORTE
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#0c0c0c] border-white/10 text-white w-[95vw] md:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-xl font-black uppercase italic tracking-tighter">Reporte Táctico</DialogTitle>
              <DialogDescription className="text-muted-foreground text-xs uppercase font-bold">
                Análisis inmediato de seguridad.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 md:gap-6 py-4">
              <div className="grid gap-2">
                <Label htmlFor="type" className="text-[10px] font-black uppercase tracking-widest text-primary">Tipo de Incidente</Label>
                <Input 
                  id="type" 
                  placeholder="Ej: Acceso no autorizado" 
                  className="bg-black/50 border-white/10 h-11" 
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="location" className="text-[10px] font-black uppercase tracking-widest text-primary">Ubicación</Label>
                <Input 
                  id="location" 
                  placeholder="Ej: Sector 4" 
                  className="bg-black/50 border-white/10 h-11"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="desc" className="text-[10px] font-black uppercase tracking-widest text-primary">Descripción</Label>
                <Textarea 
                  id="desc" 
                  placeholder="Detalle los hechos..." 
                  className="bg-black/50 border-white/10 min-h-[100px]"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter className="mt-2">
              <Button 
                onClick={handleAnalyzeAndSave} 
                disabled={isAnalyzing}
                className="w-full bg-primary text-black font-black uppercase text-xs h-12"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ANALIZANDO...
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-4 h-4 mr-2" />
                    PRIORIZAR
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="bg-[#0c0c0c]/60 border-white/5 shadow-2xl overflow-hidden backdrop-blur-sm">
        <CardHeader className="pb-4 md:pb-6 pt-6 md:pt-10 px-6 md:px-10">
          <CardTitle className="text-xl md:text-2xl font-black text-white uppercase tracking-tight">
            INCIDENTES
          </CardTitle>
          <CardDescription className="text-muted-foreground text-[10px] font-bold opacity-60 tracking-tight uppercase">
            Registro de fuerza operativa.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 md:px-10 pb-8 md:pb-16">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="border-none">
                <TableRow className="hover:bg-transparent border-none">
                  <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">FECHA</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">TIPO / DESC</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">NIVEL</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4 text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow className="border-none">
                    <TableCell colSpan={4} className="h-64 text-center">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                    </TableCell>
                  </TableRow>
                ) : incidents && incidents.length > 0 ? (
                  incidents.map((incident) => (
                    <TableRow key={incident.id} className="border-white/5 hover:bg-white/[0.02] h-20">
                      <TableCell className="text-[10px] font-mono text-white/70 px-4">
                        {incident.time?.toDate().toLocaleDateString() || "Pendiente"}
                      </TableCell>
                      <TableCell className="px-4">
                        <div className="flex flex-col">
                          <span className="text-[10px] md:text-xs font-black uppercase text-white italic truncate max-w-[100px] md:max-w-none">{incident.incidentType}</span>
                          <span className="text-[9px] text-muted-foreground line-clamp-1 max-w-[100px] md:max-w-none">{incident.description}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4">
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                          incident.priorityLevel === 'Critical' ? 'bg-red-500 text-white' :
                          incident.priorityLevel === 'High' ? 'bg-orange-500 text-white' :
                          incident.priorityLevel === 'Medium' ? 'bg-yellow-500 text-black' :
                          'bg-blue-500 text-white'
                        }`}>
                          {incident.priorityLevel}
                        </span>
                      </TableCell>
                      <TableCell className="text-right px-4">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive/50 hover:text-destructive"
                          onClick={() => handleDelete(incident.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="border-none hover:bg-transparent">
                    <TableCell colSpan={4} className="h-64 text-center">
                      <div className="flex flex-col items-center justify-center space-y-4">
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 italic">
                          No hay incidentes.
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

"use client"

import { useState, useRef, useEffect } from "react"
import { X, Send, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useUser, useSupabase } from "@/supabase"
import { fetchInternalApi } from "@/lib/internal-api"
import Image from "next/image"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
}

type AssistantContext = {
  operationTerm?: string
  supervisorTerm?: string
  postTerm?: string
  hourStart?: number
  hourEnd?: number
}

function extractContext(text: string, prev: AssistantContext): AssistantContext {
  const next = { ...prev }
  const operation = text.match(/\b(?:operaci[oó]n|operation)\s*(?:de|:)?\s*([a-z0-9áéíóúñ _-]{3,})/i)?.[1]?.trim()
  const supervisor = text.match(/\b(?:supervisor|encargad[oa])\s*(?:de|:)?\s*([a-z0-9áéíóúñ._ -]{3,})/i)?.[1]?.trim()
  const post = text.match(/\b(?:puesto|post)\s*(?:de|:)?\s*([a-z0-9áéíóúñ _-]{2,})/i)?.[1]?.trim()
  const hourRange = text.match(/\b(\d{1,2})(?::\d{2})?\s*(am|pm)?\s*(?:a|-|hasta)\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/i)
  if (operation) next.operationTerm = operation
  if (supervisor) next.supervisorTerm = supervisor
  if (post) next.postTerm = post
  if (hourRange) {
    const to24h = (raw: string, meridiem?: string) => {
      let hour = Number.parseInt(raw, 10) % 24
      const m = (meridiem ?? "").toLowerCase()
      if (m === "pm" && hour < 12) hour += 12
      if (m === "am" && hour === 12) hour = 0
      return hour
    }
    next.hourStart = to24h(hourRange[1], hourRange[2])
    next.hourEnd = to24h(hourRange[3], hourRange[4])
  }
  return next
}

export function AiAssistant() {
  const { user } = useUser()
  const { supabase } = useSupabase()
  const roleLevel = Number(user?.roleLevel ?? 1)
  const canUseAi = roleLevel >= 2

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [context, setContext] = useState<AssistantContext>({})
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || typeof window === "undefined") return
    const isMobile = window.matchMedia("(max-width: 768px)").matches
    if (isMobile) return
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading])

  if (!canUseAi) return null

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || loading) return
    const mergedContext = extractContext(content, context)
    setContext(mergedContext)

    const userMsg: Message = { id: Date.now().toString(), role: "user", content }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setLoading(true)

    const assistantId = (Date.now() + 1).toString()
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }])

    try {
      const history = [...messages, userMsg]
        .map((m) => ({ role: m.role, content: m.content }))

      const response = await fetchInternalApi(supabase, "/api/ai/assistant", {
        method: "POST",
        body: JSON.stringify({ messages: history, context: mergedContext }),
      })

      if (!response.ok || !response.body) {
        const data = (await response.json()) as { error?: string }
        setMessages((prev) => prev.map((m) => m.id === assistantId
          ? { ...m, content: `⚠️ ${data.error ?? "No se pudo obtener respuesta."}` }
          : m
        ))
        return
      }

      // Leer stream token a token
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += decoder.decode(value, { stream: true })
        setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: accumulated } : m))
      }

      if (!accumulated.trim()) {
        setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: "⚠️ Sin respuesta." } : m))
      }
    } catch {
      setMessages((prev) => prev.map((m) => m.id === assistantId
        ? { ...m, content: "⚠️ Error de red. Intenta de nuevo." }
        : m
      ))
    } finally {
      setLoading(false)
    }
  }

  const hasUserMessages = messages.some((m) => m.role === "user")

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-50 w-14 h-14 rounded-full bg-white border border-purple-200 shadow-lg flex items-center justify-center transition-all hover:scale-105"
          title="Julieta · Asistente IA"
        >
          <Image
            src="/julieta.png"
            alt="Julieta"
            width={42}
            height={42}
            className="rounded-full object-cover"
          />
        </button>
      )}

      {open && (
        <div className="fixed bottom-4 left-2 right-2 z-50 h-[560px] w-auto max-w-[calc(100vw-1rem)] sm:left-auto sm:right-4 sm:w-[390px] sm:max-w-[390px] flex flex-col rounded-2xl border border-black/10 bg-white shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-black/10 bg-white">
            <div className="flex items-center gap-2">
              <Image
                src="/julieta.png"
                alt="Julieta"
                width={28}
                height={28}
                className="rounded-full border border-purple-200"
              />
              <div>
                <p className="text-[11px] font-black uppercase text-slate-800 tracking-wider">Julieta</p>
                <p className="text-[9px] text-purple-600 font-bold uppercase">Asistente IA · L{roleLevel}</p>
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              onClick={() => setOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-white">
            {!hasUserMessages && !loading ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <Image
                  src="/julieta.png"
                  alt="Julieta"
                  width={180}
                  height={180}
                  className="rounded-2xl shadow-sm border border-purple-100"
                />
                <p className="mt-5 text-[13px] leading-relaxed text-slate-700 font-medium">
                  Hola, soy Julieta. Durante mucho tiempo cuidé de la oficina, y ahora me encargo de cuidar tus respuestas. ¿En qué puedo ayudarte hoy?
                </p>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap ${
                        msg.role === "user"
                          ? "bg-purple-600 text-white rounded-br-sm"
                          : "bg-slate-100 text-slate-800 border border-slate-200 rounded-bl-sm"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}

                {loading && messages[messages.length - 1]?.content === "" && (
                  <div className="flex justify-start">
                    <div className="bg-slate-100 border border-slate-200 rounded-xl rounded-bl-sm px-3 py-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-500" />
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-black/10 p-3 flex items-center gap-2 bg-white">
            <div className="flex-1 space-y-1">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage() } }}
                placeholder="Escribe tu consulta..."
                disabled={loading}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-base text-slate-800 placeholder:text-slate-400 outline-none focus:border-purple-400 disabled:opacity-50"
              />
            </div>
            <Button
              size="icon"
              onClick={() => void sendMessage()}
              disabled={!input.trim() || loading}
              className="h-8 w-8 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

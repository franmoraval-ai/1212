"use client"

import { useState, useRef, useEffect } from "react"
import { Sparkles, X, Send, Loader2, Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useUser, useSupabase } from "@/supabase"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
}

const SUGGESTED_QUESTIONS = [
  "¿Hubo novedades hoy?",
  "Dame un resumen de supervisiones de esta semana",
  "¿Qué incidentes hubo este mes?",
  "Resumen de rondas de hoy",
  "¿Qué visitantes entraron ayer?",
]

export function AiAssistant() {
  const { user } = useUser()
  const { supabase } = useSupabase()
  const roleLevel = Number(user?.roleLevel ?? 1)
  const canUseAi = roleLevel >= 3

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
      if (messages.length === 0) {
        setMessages([
          {
            id: "welcome",
            role: "assistant",
            content: "Hola, soy tu asistente operativo IA 👋\nPuedo consultarte sobre supervisiones, rondas, incidentes, visitantes, armas y notas internas de los últimos 30 días.\n¿En qué te ayudo?",
          },
        ])
      }
    }
  }, [open, messages.length])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading])

  if (!canUseAi) return null

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || loading) return

    const userMsg: Message = { id: Date.now().toString(), role: "user", content }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setLoading(true)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = String(sessionData?.session?.access_token ?? "").trim()

      const history = [...messages, userMsg]
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }))

      const response = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ messages: history }),
      })

      const data = (await response.json()) as { reply?: string; error?: string }

      if (!response.ok || !data.reply) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: "assistant",
            content: `⚠️ ${data.error ?? "No se pudo obtener respuesta."}`,
          },
        ])
        return
      }

      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "assistant", content: data.reply! },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "assistant", content: "⚠️ Error de red. Intenta de nuevo." },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Botón flotante */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-50 w-12 h-12 rounded-full bg-purple-600 hover:bg-purple-500 text-white shadow-lg flex items-center justify-center transition-all hover:scale-110"
          title="Asistente IA"
        >
          <Sparkles className="w-5 h-5" />
        </button>
      )}

      {/* Panel de chat */}
      {open && (
        <div className="fixed bottom-4 right-4 z-50 w-[340px] sm:w-[380px] h-[520px] flex flex-col rounded-xl border border-white/10 bg-[#0c0c0c] shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/60">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-[11px] font-black uppercase text-white tracking-wider">Asistente IA</p>
                <p className="text-[9px] text-purple-300 font-bold uppercase">HO Seguridad · L{roleLevel}</p>
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-white/40 hover:text-white hover:bg-white/10"
              onClick={() => setOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-purple-600 text-white rounded-br-sm"
                      : "bg-white/5 text-white/90 border border-white/10 rounded-bl-sm"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-white/5 border border-white/10 rounded-xl rounded-bl-sm px-3 py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-300" />
                </div>
              </div>
            )}

            {/* Sugerencias si no hay mensajes del usuario */}
            {messages.filter((m) => m.role === "user").length === 0 && !loading && (
              <div className="space-y-1.5 pt-1">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => void sendMessage(q)}
                    className="w-full text-left text-[10px] text-white/60 hover:text-white border border-white/10 hover:border-purple-500/50 rounded-lg px-3 py-2 transition-colors hover:bg-white/5"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-white/10 p-3 flex items-center gap-2 bg-black/40">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage() } }}
              placeholder="Escribe tu consulta..."
              disabled={loading}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white placeholder:text-white/30 outline-none focus:border-purple-500/50 disabled:opacity-50"
            />
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

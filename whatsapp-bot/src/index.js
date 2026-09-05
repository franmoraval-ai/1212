import "dotenv/config"
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys"
import pino from "pino"
import qrcode from "qrcode-terminal"
import { parseWhatsappReportMessage } from "./parser.js"
import { submitAttendance, submitReport } from "./apiClient.js"

// Baileys' default logger dumps raw message/media buffers at info level; keep only warnings/errors.
const baileysLogger = pino({ level: "warn" })

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || "./auth_info"
const ALLOWED_GROUP_IDS = new Set(
  String(process.env.WHATSAPP_GROUP_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
)

function extractMessageText(message) {
  const content = message.message
  if (!content) return ""
  return String(
    content.conversation
    ?? content.extendedTextMessage?.text
    ?? content.imageMessage?.caption
    ?? content.videoMessage?.caption
    ?? ""
  ).trim()
}

function buildSuccessReply(parsed, data) {
  if (parsed.kind === "check_in") return `✅ Entrada registrada: ${data.officerName} - ${data.stationLabel}`
  if (parsed.kind === "check_out") {
    const minutes = typeof data.workedMinutes === "number" ? ` (${data.workedMinutes} min)` : ""
    return `✅ Salida registrada: ${data.officerName} - ${data.stationLabel}${minutes}`
  }
  return `✅ Reporte registrado: ${data.incidentType} - ${data.stationLabel}`
}

async function handleMessage(sock, message) {
  const remoteJid = message.key.remoteJid
  if (!remoteJid || !remoteJid.endsWith("@g.us")) return
  if (ALLOWED_GROUP_IDS.size > 0 && !ALLOWED_GROUP_IDS.has(remoteJid)) return
  if (message.key.fromMe) return

  const text = extractMessageText(message)
  const parsed = parseWhatsappReportMessage(text)
  if (!parsed) return

  const occurredAt = new Date(Number(message.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000).toISOString()
  const sourceMessageId = message.key.id ?? ""

  const result = parsed.kind === "report"
    ? await submitReport({
        officerQuery: parsed.officerQuery,
        stationQuery: parsed.stationQuery,
        tipo: parsed.tipo,
        descripcion: parsed.descripcion,
        occurredAt,
        sourceMessageId,
        groupId: remoteJid,
      })
    : await submitAttendance({
        type: parsed.kind,
        officerQuery: parsed.officerQuery,
        stationQuery: parsed.stationQuery,
        occurredAt,
        sourceMessageId,
        groupId: remoteJid,
      })

  const replyText = result.ok ? buildSuccessReply(parsed, result.data) : `❌ ${result.data?.error || "No se pudo registrar."}`
  await sock.sendMessage(remoteJid, { text: replyText }, { quoted: message })
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: baileysLogger,
  })

  sock.ev.on("creds.update", saveCreds)

  // Pairing-code login is far more reliable than scanning an ASCII QR through a web log viewer.
  const pairingPhoneNumber = String(process.env.WHATSAPP_PHONE_NUMBER ?? "").replace(/[^0-9]/g, "")
  let pairingCodeRequested = false

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      // The qr event fires only once the initial handshake with WhatsApp finished; requesting the
      // pairing code any earlier fails with "428 Precondition Required".
      if (pairingPhoneNumber && !pairingCodeRequested && !sock.authState.creds.registered) {
        pairingCodeRequested = true
        try {
          const code = await sock.requestPairingCode(pairingPhoneNumber)
          console.log(`>>> CODIGO DE VINCULACION: ${code} <<<`)
          console.log("En WhatsApp: Dispositivos vinculados > Vincular con numero de telefono > ingresa ese codigo.")
        } catch (error) {
          console.error("No se pudo generar el codigo de vinculacion:", error)
        }
      } else if (!pairingPhoneNumber) {
        qrcode.generate(qr, { small: true })
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut
      console.log("Conexion cerrada.", { statusCode, shouldReconnect })
      console.log("Detalle del cierre:", JSON.stringify(lastDisconnect?.error?.output?.payload ?? lastDisconnect?.error ?? {}, null, 2))
      if (shouldReconnect) start()
    } else if (connection === "open") {
      console.log("Bot de WhatsApp conectado.")
    }
  })

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const message of messages) {
      try {
        await handleMessage(sock, message)
      } catch (error) {
        console.error("Error procesando mensaje:", error)
      }
    }
  })
}

start().catch((error) => {
  console.error("Error iniciando bot:", error)
  process.exit(1)
})

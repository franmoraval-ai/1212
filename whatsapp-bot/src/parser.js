function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

// Parses fixed-format group messages: "ENTRADA/SALIDA/REPORTE" header + "Clave: valor" lines.
export function parseWhatsappReportMessage(rawText) {
  const text = String(rawText ?? "").trim()
  if (!text) return null

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return null

  const command = normalizeKey(lines[0])
  const isEntrada = command === "entrada"
  const isSalida = command === "salida"
  const isReporte = command === "reporte" || command === "novedad"
  if (!isEntrada && !isSalida && !isReporte) return null

  const fields = {}
  for (const line of lines.slice(1)) {
    const separatorIndex = line.indexOf(":")
    if (separatorIndex === -1) continue
    const key = normalizeKey(line.slice(0, separatorIndex))
    const value = line.slice(separatorIndex + 1).trim()
    if (!value) continue
    if (key === "puesto") fields.puesto = value
    else if (key === "oficial") fields.oficial = value
    else if (key === "cedula") fields.cedula = value
    else if (key === "tipo") fields.tipo = value
    else if (key === "descripcion") fields.descripcion = value
  }

  if (isEntrada || isSalida) {
    if (!fields.puesto || !fields.oficial) return null
    return {
      kind: isEntrada ? "check_in" : "check_out",
      stationQuery: fields.puesto,
      officerQuery: fields.oficial,
      officerIdNumber: fields.cedula || "",
    }
  }

  if (!fields.puesto || !fields.oficial || !fields.descripcion) return null
  return {
    kind: "report",
    stationQuery: fields.puesto,
    officerQuery: fields.oficial,
    officerIdNumber: fields.cedula || "",
    tipo: fields.tipo || "Novedad",
    descripcion: fields.descripcion,
  }
}

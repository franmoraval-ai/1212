import * as ExcelJS from "exceljs"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { format } from "date-fns"

export async function exportToExcel(
  data: Record<string, unknown>[],
  sheetName: string,
  columns: { header: string; key: string; width?: number }[],
  filename: string
) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName, { properties: { tabColor: { argb: "FFC5A059" } } })

  sheet.columns = columns
  data.forEach((row) => sheet.addRow(row))

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${filename}_${format(new Date(), "yyyyMMdd")}.xlsx`
  anchor.click()
  window.URL.revokeObjectURL(url)
}

export function exportToPdf(
  title: string,
  headers: string[],
  rows: (string | number)[][],
  filename: string
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })

  doc.setFontSize(16)
  doc.text(`HO SEGURIDAD - ${title}`, 14, 12)
  doc.setFontSize(9)
  doc.text(format(new Date(), "dd/MM/yyyy HH:mm"), doc.internal.pageSize.getWidth() - 40, 12)

  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 20,
    theme: "plain",
    headStyles: { fillColor: [37, 38, 39], textColor: 250 },
    styles: { fontSize: 8 },
    margin: { left: 14, right: 14 },
  })

  doc.save(`${filename}_${format(new Date(), "yyyyMMdd")}.pdf`)
}

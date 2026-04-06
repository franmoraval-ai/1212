import * as ExcelJS from "exceljs"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { format } from "date-fns"

export type ExportResult = { ok: true } | { ok: false; error: string }

export async function exportToExcel(
  data: Record<string, unknown>[],
  sheetName: string,
  columns: { header: string; key: string; width?: number }[],
  filename: string
): Promise<ExportResult> {
  try {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet(sheetName, { properties: { tabColor: { argb: "FFC5A059" } } })

    sheet.columns = columns
    data.forEach((row) => sheet.addRow(row))

    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: Math.max(columns.length, 1) },
    }

    const headerRow = sheet.getRow(1)
    headerRow.font = { bold: true, color: { argb: "FFF8F5EE" } }
    headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A8A" },
    }
    headerRow.height = 26

    sheet.eachRow((row, rowNumber) => {
      row.alignment = { vertical: "top", wrapText: true }
      if (rowNumber > 1 && rowNumber % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF7F7F7" },
          }
        })
      }
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFD9D9D9" } },
          left: { style: "thin", color: { argb: "FFD9D9D9" } },
          bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
          right: { style: "thin", color: { argb: "FFD9D9D9" } },
        }
      })
    })

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${filename}_${format(new Date(), "yyyyMMdd")}.xlsx`
    anchor.click()
    window.URL.revokeObjectURL(url)
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al generar Excel"
    return { ok: false, error: message }
  }
}

export function exportToPdf(
  title: string,
  headers: string[],
  rows: (string | number)[][],
  filename: string
): ExportResult {
  try {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })

    doc.setFontSize(16)
    doc.text(`HO SEGURIDAD - ${title}`, 14, 12)
    doc.setFontSize(9)
    doc.text(format(new Date(), "dd/MM/yyyy HH:mm"), doc.internal.pageSize.getWidth() - 40, 12)

    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: 20,
      theme: "grid",
      headStyles: { fillColor: [30, 58, 138], textColor: 250, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 247, 247] },
      styles: { fontSize: 8, cellPadding: 2, valign: "top", overflow: "linebreak" },
      margin: { left: 14, right: 14 },
      didDrawPage: () => {
        doc.setFontSize(8)
        doc.text(
          `Generado ${format(new Date(), "dd/MM/yyyy HH:mm")}`,
          14,
          doc.internal.pageSize.getHeight() - 6
        )
      },
    })

    doc.save(`${filename}_${format(new Date(), "yyyyMMdd")}.pdf`)
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al generar PDF"
    return { ok: false, error: message }
  }
}

import jsPDF from "jspdf";
import type { RiskAssessment } from "@shared/scan-types";

export interface AuditReportData {
  tokenName: string;
  tokenSymbol: string;
  tokenAddress: string;
  creatorAddress: string;
  chainLabel: string;
  totalSupply: number;
  topHolderPercent: number;
  reinvestedPercent: number;
  movedElsewherePercent: number;
  launchDate: string | null;
  launchTimestamp: number | null;
  topHolders: { address: string; percent: number }[];
  risk: RiskAssessment;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toUTCString();
  } catch {
    return iso;
  }
}

export function generateAuditPdf(d: AuditReportData): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const line = (
    text: string,
    opts: { size?: number; bold?: boolean; gap?: number; color?: [number, number, number] } = {},
  ) => {
    const { size = 10, bold = false, gap = 6, color = [20, 20, 20] } = opts;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const wrapped = doc.splitTextToSize(text, maxWidth);
    for (const w of wrapped) {
      if (y > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(w, margin, y);
      y += size + gap;
    }
  };

  const rule = () => {
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;
  };

  line("PAIF.fun — Token Risk & Compliance Audit", { size: 18, bold: true, gap: 8 });
  line(`Generated: ${fmtDate(d.risk.generatedAt)}`, { size: 9, color: [120, 120, 120], gap: 4 });
  line(`Chain: ${d.chainLabel}   ·   Confidence: ${d.risk.confidence.toUpperCase()}`, {
    size: 9,
    color: [120, 120, 120],
    gap: 10,
  });
  rule();

  line("Token", { size: 12, bold: true });
  line(`${d.tokenName} (${d.tokenSymbol || "—"})`);
  line(`Contract: ${d.tokenAddress}`, { size: 9, color: [90, 90, 90] });
  line(`Creator: ${d.creatorAddress || "—"}`, { size: 9, color: [90, 90, 90] });
  line(`Total supply: ${d.totalSupply.toLocaleString()}`, { size: 9, color: [90, 90, 90] });
  if (d.launchDate) line(`Launch: ${d.launchTimestamp ? new Date(d.launchTimestamp).toUTCString() : d.launchDate}`, { size: 9, color: [90, 90, 90], gap: 10 });
  rule();

  const bandColor: [number, number, number] =
    d.risk.band === "low" ? [22, 163, 74] : d.risk.band === "medium" ? [202, 138, 4] : [220, 38, 38];
  line("Overall Risk", { size: 12, bold: true });
  line(`Score ${d.risk.score}/100   ·   Grade ${d.risk.grade}   ·   ${d.risk.band.toUpperCase()} RISK`, {
    size: 13,
    bold: true,
    color: bandColor,
    gap: 10,
  });
  if (d.risk.sanctioned) {
    line(`SANCTIONS ALERT: ${d.risk.sanctionDetail}`, { size: 10, bold: true, color: [220, 38, 38], gap: 10 });
  }
  line(`Sanctions screening coverage: ${d.risk.sanctionsCoverage}`, {
    size: 9,
    color: [120, 120, 120],
    gap: 10,
  });
  rule();

  line("Category Breakdown", { size: 12, bold: true });
  for (const c of d.risk.categories) {
    line(`${c.label} — ${c.score}/100 (weight ${(c.weight * 100).toFixed(0)}%)`, { size: 10, bold: true, gap: 2 });
    line(c.detail, { size: 9, color: [90, 90, 90] });
  }
  rule();

  line("Flags", { size: 12, bold: true });
  if (d.risk.flags.length === 0) {
    line("No flags raised.", { size: 9, color: [90, 90, 90] });
  } else {
    for (const f of d.risk.flags) {
      const fc: [number, number, number] =
        f.severity === "critical" ? [220, 38, 38] : f.severity === "warning" ? [202, 138, 4] : [90, 90, 90];
      line(`[${f.severity.toUpperCase()}] ${f.label}`, { size: 10, bold: true, color: fc, gap: 2 });
      line(f.detail, { size: 9, color: [90, 90, 90] });
    }
  }
  rule();

  line("Top Holders", { size: 12, bold: true });
  if (d.topHolders.length === 0) {
    line("No holder data available.", { size: 9, color: [90, 90, 90] });
  } else {
    d.topHolders.slice(0, 20).forEach((h, i) => {
      line(`#${i + 1}  ${h.address}  —  ${h.percent.toFixed(2)}%`, { size: 9, color: [60, 60, 60], gap: 2 });
    });
  }
  y += 8;
  rule();
  line(
    "This report is generated from on-chain data and is provided for informational and risk-screening purposes only. It is not financial advice. Sanctions screening uses a bundled subset of the OFAC SDN crypto-address list and should be corroborated against the live OFAC feed for regulated use.",
    { size: 8, color: [140, 140, 140] },
  );

  doc.save(`paif-audit-${(d.tokenSymbol || d.tokenAddress).slice(0, 12)}.pdf`);
}

export function generateAuditCsv(d: AuditReportData): void {
  const rows: string[][] = [
    ["field", "value"],
    ["generated_at", d.risk.generatedAt],
    ["chain", d.chainLabel],
    ["confidence", d.risk.confidence],
    ["token_name", d.tokenName],
    ["token_symbol", d.tokenSymbol],
    ["token_address", d.tokenAddress],
    ["creator_address", d.creatorAddress],
    ["total_supply", String(d.totalSupply)],
    ["launch_date", d.launchDate || ""],
    ["launch_time_utc", d.launchTimestamp ? new Date(d.launchTimestamp).toUTCString() : ""],
    ["risk_score", String(d.risk.score)],
    ["risk_grade", d.risk.grade],
    ["risk_band", d.risk.band],
    ["sanctioned", String(d.risk.sanctioned)],
    ["sanction_detail", d.risk.sanctionDetail || ""],
    ["sanctions_coverage", d.risk.sanctionsCoverage],
    ["top_holder_percent", String(d.topHolderPercent)],
    ["in_liquidity_percent", String(d.reinvestedPercent)],
    ["distributed_percent", String(d.movedElsewherePercent)],
  ];
  for (const c of d.risk.categories) {
    rows.push([`category_${c.key}_score`, String(c.score)]);
  }
  d.risk.flags.forEach((f, i) => {
    rows.push([`flag_${i + 1}`, `${f.severity}: ${f.label} — ${f.detail}`]);
  });
  d.topHolders.slice(0, 20).forEach((h, i) => {
    rows.push([`holder_${i + 1}`, `${h.address} (${h.percent.toFixed(2)}%)`]);
  });

  // Neutralize spreadsheet formula injection: cells beginning with =, +, -, @,
  // tab, or CR are prefixed with a single quote so Excel/Sheets treat them as text.
  const csvCell = (v: unknown): string => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `paif-audit-${(d.tokenSymbol || d.tokenAddress).slice(0, 12)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

#!/usr/bin/env python3
"""Generate an HTML summary report from reads-qc statistics TSV."""

import csv
import sys
from datetime import datetime
from html import escape


def fmt_int(val):
    """Format an integer with thousand separators."""
    try:
        return f"{int(float(val)):,}"
    except (ValueError, TypeError):
        return val or "-"


def fmt_float(val, decimals=1):
    """Format a float to given decimal places."""
    try:
        return f"{float(val):.{decimals}f}"
    except (ValueError, TypeError):
        return val or "-"


def quality_color(val):
    """Return a CSS color class based on average quality score."""
    try:
        q = float(val)
        if q >= 30:
            return "good"
        elif q >= 20:
            return "ok"
        else:
            return "poor"
    except (ValueError, TypeError):
        return ""


def main():
    if len(sys.argv) < 3:
        print("Usage: generate_report.py <input.tsv> <output.html>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    rows = []
    with open(input_path, newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            rows.append(row)

    # Compute summary statistics
    samples = set()
    total_reads = 0
    total_bases = 0
    qualities = []
    for row in rows:
        samples.add(row.get("sample_id", ""))
        try:
            total_reads += int(float(row.get("num_reads", 0)))
        except (ValueError, TypeError):
            pass
        try:
            total_bases += int(float(row.get("total_bases", 0)))
        except (ValueError, TypeError):
            pass
        try:
            q = float(row.get("avg_quality", 0))
            if q > 0:
                qualities.append(q)
        except (ValueError, TypeError):
            pass

    num_samples = len(samples)
    mean_quality = sum(qualities) / len(qualities) if qualities else 0

    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reads QC Report</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a2e; background: #f8f9fa; padding: 2rem; }}
  .container {{ max-width: 1100px; margin: 0 auto; }}
  h1 {{ font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }}
  .subtitle {{ color: #6b7280; font-size: 0.875rem; margin-bottom: 1.5rem; }}
  .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }}
  .stat-card {{ background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; }}
  .stat-card .label {{ font-size: 0.75rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }}
  .stat-card .value {{ font-size: 1.5rem; font-weight: 600; margin-top: 0.25rem; }}
  table {{ width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }}
  th {{ background: #f9fafb; text-align: left; padding: 0.625rem 0.75rem; font-size: 0.75rem; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e5e7eb; }}
  td {{ padding: 0.5rem 0.75rem; font-size: 0.8125rem; border-bottom: 1px solid #f3f4f6; }}
  tr:last-child td {{ border-bottom: none; }}
  tr:nth-child(even) {{ background: #f9fafb; }}
  .badge {{ display: inline-block; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; }}
  .good {{ background: #d1fae5; color: #065f46; }}
  .ok {{ background: #fef3c7; color: #92400e; }}
  .poor {{ background: #fee2e2; color: #991b1b; }}
  .r2 {{ color: #6b7280; }}
  .mono {{ font-family: "SF Mono", Monaco, "Cascadia Code", monospace; font-size: 0.8125rem; }}
  footer {{ margin-top: 2rem; color: #9ca3af; font-size: 0.75rem; text-align: center; }}
</style>
</head>
<body>
<div class="container">
  <h1>Reads QC Report</h1>
  <p class="subtitle">Generated {escape(now)}</p>

  <div class="summary">
    <div class="stat-card">
      <div class="label">Samples</div>
      <div class="value">{num_samples}</div>
    </div>
    <div class="stat-card">
      <div class="label">Total Reads</div>
      <div class="value">{total_reads:,}</div>
    </div>
    <div class="stat-card">
      <div class="label">Total Bases</div>
      <div class="value">{total_bases:,}</div>
    </div>
    <div class="stat-card">
      <div class="label">Mean Quality</div>
      <div class="value"><span class="badge {quality_color(mean_quality)}">{mean_quality:.1f}</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Sample</th>
        <th>Read</th>
        <th>Reads</th>
        <th>Bases</th>
        <th>Avg Len</th>
        <th>Min Len</th>
        <th>Max Len</th>
        <th>N50</th>
        <th>Avg Qual</th>
        <th>GC %</th>
        <th>Q20 %</th>
        <th>Q30 %</th>
      </tr>
    </thead>
    <tbody>
"""

    for row in rows:
        read_end = escape(row.get("read_end", ""))
        row_class = ' class="r2"' if read_end == "R2" else ""
        qc = quality_color(row.get("avg_quality", ""))
        qual_badge = f'<span class="badge {qc}">{fmt_float(row.get("avg_quality"))}</span>' if qc else fmt_float(row.get("avg_quality"))

        html += f"""      <tr{row_class}>
        <td class="mono">{escape(row.get("sample_id", ""))}</td>
        <td>{read_end}</td>
        <td>{fmt_int(row.get("num_reads"))}</td>
        <td>{fmt_int(row.get("total_bases"))}</td>
        <td>{fmt_float(row.get("avg_len"))}</td>
        <td>{fmt_int(row.get("min_len"))}</td>
        <td>{fmt_int(row.get("max_len"))}</td>
        <td>{fmt_int(row.get("n50"))}</td>
        <td>{qual_badge}</td>
        <td>{fmt_float(row.get("gc_content"))}</td>
        <td>{fmt_float(row.get("q20_pct"))}</td>
        <td>{fmt_float(row.get("q30_pct"))}</td>
      </tr>
"""

    html += """    </tbody>
  </table>

  <footer>Generated by SeqDesk Reads QC pipeline</footer>
</div>
</body>
</html>
"""

    with open(output_path, "w") as f:
        f.write(html)


if __name__ == "__main__":
    main()

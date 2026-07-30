nextflow.enable.dsl=2

params.input = null
params.outdir = 'output'
params.report_title = 'SeqDesk demo pipeline report'

def parseRfc4180Csv(String content) {
  if (content == null || content.isEmpty()) {
    throw new IllegalArgumentException("Study demo samplesheet is empty")
  }

  def records = []
  def row = []
  def field = new StringBuilder()
  def inQuotes = false
  def afterClosingQuote = false
  def skipNext = false

  content.toCharArray().eachWithIndex { value, index ->
    if (skipNext) {
      skipNext = false
    } else {
      if (inQuotes) {
        if (value == '"') {
          if (
            index + 1 < content.length() &&
            content.charAt(index + 1) == '"'
          ) {
            field.append('"')
            skipNext = true
          } else {
            inQuotes = false
            afterClosingQuote = true
          }
        } else {
          field.append(value)
        }
      } else if (afterClosingQuote) {
        if (value == ',') {
          row.add(field.toString())
          field.setLength(0)
          afterClosingQuote = false
        } else if (value == '\r' || value == '\n') {
          if (
            value == '\r' &&
            (index + 1 >= content.length() || content.charAt(index + 1) != '\n')
          ) {
            throw new IllegalArgumentException(
              "Study demo samplesheet contains a bare carriage return"
            )
          }
          row.add(field.toString())
          records.add(row)
          row = []
          field.setLength(0)
          afterClosingQuote = false
          if (value == '\r') {
            skipNext = true
          }
        } else {
          throw new IllegalArgumentException(
            "Study demo samplesheet contains characters after a closing quote"
          )
        }
      } else if (value == '"') {
        if (field.length() != 0) {
          throw new IllegalArgumentException(
            "Study demo samplesheet contains a quote inside an unquoted field"
          )
        }
        inQuotes = true
      } else if (value == ',') {
        row.add(field.toString())
        field.setLength(0)
      } else if (value == '\r' || value == '\n') {
        if (
          value == '\r' &&
          (index + 1 >= content.length() || content.charAt(index + 1) != '\n')
        ) {
          throw new IllegalArgumentException(
            "Study demo samplesheet contains a bare carriage return"
          )
        }
        row.add(field.toString())
        records.add(row)
        row = []
        field.setLength(0)
        if (value == '\r') {
          skipNext = true
        }
      } else {
        field.append(value)
      }
    }
  }

  if (inQuotes) {
    throw new IllegalArgumentException(
      "Study demo samplesheet contains an unterminated quoted field"
    )
  }
  if (afterClosingQuote || field.length() != 0 || !row.isEmpty()) {
    row.add(field.toString())
    records.add(row)
  }

  records
}

process BUILD_DEMO_REPORT {
  tag "study-demo-report"

  publishDir "${params.outdir}", mode: 'copy', pattern: "report/*"
  publishDir "${params.outdir}", mode: 'copy', pattern: "tables/*"

  input:
    val sample_rows

  output:
    path "report/demo-report.html", emit: html_report
    path "report/demo-report.md", emit: markdown_report
    path "tables/sample-summary.tsv", emit: sample_summary

  exec:
    if (sample_rows == null || sample_rows.isEmpty()) {
      throw new IllegalArgumentException("Study demo samplesheet contains no sample rows")
    }
    def invalidRow = sample_rows.find { row ->
      row == null ||
        row.size() != 3 ||
        row.any { value ->
          !(value instanceof String) ||
            value.isEmpty() ||
            value.contains("\t") ||
            value.contains("\r") ||
            value.contains("\n")
        }
    }
    if (invalidRow != null) {
      throw new IllegalArgumentException(
        "Study demo samplesheet contains an invalid or non-TSV-safe row"
      )
    }
    def sampleIds = sample_rows.collect { row -> row[0] }
    if (sampleIds.toSet().size() != sampleIds.size()) {
      throw new IllegalArgumentException(
        "Study demo samplesheet contains duplicate sample_id values"
      )
    }
    def studyIds = sample_rows.collect { row -> row[1] }.toSet()
    def studyTitles = sample_rows.collect { row -> row[2] }.toSet()
    if (studyIds.size() != 1 || studyTitles.size() != 1) {
      throw new IllegalArgumentException(
        "Study demo samplesheet rows must describe exactly one study"
      )
    }

    def studyTitle = sample_rows[0][2]
    def sampleCount = sample_rows.size()
    def reportTitle = params.report_title.toString()
    def summaryRows = sample_rows.withIndex().collect { row, index ->
      "${row[0]}\t${row[1]}\t${row[2]}\t${index + 1}"
    }
    def escapedReportTitle = reportTitle
      .replace("&", "&amp;")
      .replace("<", "&lt;")
      .replace(">", "&gt;")
      .replace('"', "&quot;")
      .replace("'", "&#39;")
    def escapedStudyTitle = studyTitle
      .replace("&", "&amp;")
      .replace("<", "&lt;")
      .replace(">", "&gt;")
      .replace('"', "&quot;")
      .replace("'", "&#39;")

    def reportDir = new File(task.workDir.toString(), "report")
    def tablesDir = new File(task.workDir.toString(), "tables")
    reportDir.mkdirs()
    tablesDir.mkdirs()
    new File(tablesDir, "sample-summary.tsv").text =
      "sample_id\tstudy_id\tstudy_title\trow_number\n" +
      summaryRows.join("\n") +
      "\n"
    new File(reportDir, "demo-report.md").text = """# ${reportTitle}

Study: ${studyTitle}

Samples processed: ${sampleCount}

| Output | Purpose |
|---|---|
| demo-report.html | Browser report preview |
| demo-report.md | Markdown preview |
| sample-summary.tsv | Tabular output preview |

"""
    new File(reportDir, "demo-report.html").text = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapedReportTitle}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #111827; }
    main { max-width: 860px; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    .meta { color: #4b5563; margin-bottom: 24px; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; }
    th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; }
    th { background: #f3f4f6; }
    code { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapedReportTitle}</h1>
    <div class="meta">Study: ${escapedStudyTitle} · Samples processed: ${sampleCount}</div>
    <p>This file is generated by the SeqDesk study demo pipeline to verify pipeline execution, output discovery, preview, and download behavior.</p>
    <table>
      <thead>
        <tr><th>Artifact</th><th>Expected SeqDesk behavior</th></tr>
      </thead>
      <tbody>
        <tr><td><code>demo-report.html</code></td><td>Open as an inline HTML preview</td></tr>
        <tr><td><code>demo-report.md</code></td><td>Render as Markdown in the file browser</td></tr>
        <tr><td><code>sample-summary.tsv</code></td><td>Render as a table in the file browser</td></tr>
      </tbody>
    </table>
  </main>
</body>
</html>
"""
}

workflow {
  if (!params.input) {
    error "Missing --input samplesheet"
  }

  // Parse the full RFC-4180 quoting rules (including doubled quotes) in native
  // Groovy, then write deterministic artifacts without host Python.
  study_rows = Channel
    .fromPath(params.input, checkIfExists: true)
    .collect()
    .map { inputFiles ->
      if (inputFiles.size() != 1) {
        error "Study demo requires exactly one samplesheet"
      }
      def records = parseRfc4180Csv(inputFiles[0].text)
      if (
        records.isEmpty() ||
        records[0] != ['sample_id', 'study_id', 'study_title']
      ) {
        error "Study demo samplesheet must contain exactly sample_id, study_id, study_title"
      }
      def rows = records.drop(1)
      if (rows.isEmpty()) {
        error "Study demo samplesheet contains no sample rows"
      }
      rows.each { row ->
        if (
          row.size() != 3 ||
          row.any { value -> !(value instanceof String) || value.isEmpty() }
        ) {
          error "Every study demo row must define sample_id, study_id, and study_title"
        }
      }
      rows
    }

  BUILD_DEMO_REPORT(study_rows)
}

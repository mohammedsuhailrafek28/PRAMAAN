export const reportStyles = `
@page {
  size: A4;
  margin: 18mm 14mm 20mm;
}

* {
  box-sizing: border-box;
}

html {
  color: #20242a;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 12px;
  line-height: 1.45;
}

body {
  margin: 0;
  background: #ffffff;
}

.report {
  max-width: 940px;
  margin: 0 auto;
  padding: 32px;
}

.topline {
  align-items: flex-start;
  border-bottom: 2px solid #1d4f73;
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 18px;
}

.brand {
  color: #16344a;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 0;
}

.kicker {
  color: #59636e;
  font-size: 11px;
  font-weight: 700;
  margin-top: 4px;
  text-transform: uppercase;
}

h1 {
  color: #17202a;
  font-size: 28px;
  line-height: 1.12;
  margin: 22px 0 8px;
}

h2 {
  border-bottom: 1px solid #d9dee4;
  color: #17202a;
  font-size: 18px;
  margin: 30px 0 14px;
  padding-bottom: 7px;
}

h3 {
  color: #23313d;
  font-size: 14px;
  margin: 18px 0 8px;
}

p {
  margin: 0 0 10px;
}

.meta {
  color: #4b5663;
  font-size: 11px;
  text-align: right;
}

.statement,
.warning,
.revoked {
  border: 1px solid #c7d2dc;
  margin-top: 16px;
  padding: 12px 14px;
}

.statement {
  background: #f6f9fb;
}

.warning {
  background: #fbf8f0;
  border-color: #d8cda7;
}

.revoked {
  background: #fff4f2;
  border-color: #d9a49d;
  color: #7b1e18;
  font-weight: 700;
}

.watermark {
  border: 3px solid #a33a32;
  color: #a33a32;
  font-size: 42px;
  font-weight: 800;
  letter-spacing: 8px;
  margin: 22px 0;
  opacity: 0.16;
  padding: 16px;
  text-align: center;
}

.grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.metric-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.metric {
  border: 1px solid #d9dee4;
  padding: 12px;
  break-inside: avoid;
}

.metric-label,
.label {
  color: #59636e;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.metric-score {
  color: #17202a;
  font-size: 22px;
  font-weight: 800;
  margin: 4px 0;
}

.bar {
  background: #e7ebef;
  border: 1px solid #d4dbe2;
  height: 8px;
  margin: 8px 0;
  width: 100%;
}

.bar span {
  background: #1d4f73;
  display: block;
  height: 100%;
}

table {
  border-collapse: collapse;
  margin: 8px 0 18px;
  table-layout: fixed;
  width: 100%;
}

th,
td {
  border-bottom: 1px solid #d9dee4;
  overflow-wrap: anywhere;
  padding: 8px 7px;
  text-align: left;
  vertical-align: top;
}

th {
  background: #f3f6f8;
  color: #33414d;
  font-size: 10px;
  text-transform: uppercase;
}

.badge {
  border: 1px solid #b9c4cf;
  color: #25313c;
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  margin: 2px 4px 2px 0;
  padding: 2px 6px;
  text-transform: uppercase;
}

.muted {
  color: #66717c;
}

.section {
  break-inside: avoid-page;
}

.major {
  break-before: page;
}

.timeline-item {
  border-left: 2px solid #8aa6b8;
  margin: 0 0 12px;
  padding-left: 12px;
  break-inside: avoid;
}

.footer-note {
  border-top: 1px solid #d9dee4;
  color: #59636e;
  font-size: 10px;
  margin-top: 28px;
  padding-top: 10px;
}

@media print {
  .report {
    max-width: none;
    padding: 0;
  }

  h1,
  h2,
  h3 {
    break-after: avoid;
  }

  table {
    page-break-inside: auto;
  }

  tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  thead {
    display: table-header-group;
  }

  p,
  li {
    orphans: 3;
    widows: 3;
  }
}
`;

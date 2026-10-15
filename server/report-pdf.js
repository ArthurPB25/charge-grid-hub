import PDFDocument from 'pdfkit';

export function createReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 52, left: 46, right: 46 }, bufferPages: true,
      info: { Title: 'ChargeGrid Hub - Relatório de operação', Author: 'ChargeGrid Hub' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const width = doc.page.width - 92;
    const clean = text => String(text ?? '').replace(/[\u2010-\u2015]/g, '-');
    const style = (size = 10, bold = false, color = '#303844') => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
    const height = (text, size = 10, bold = false) => { style(size, bold); return doc.heightOfString(clean(text), { width, lineGap: 3 }); };
    const room = amount => { if (amount < doc.page.height - 106 && doc.y + amount > doc.page.height - 52) doc.addPage(); };
    const paragraph = (text, { size = 10, bold = false, color = '#303844', gap = 8 } = {}) => {
      room(height(text, size, bold) + gap);
      style(size, bold, color).text(clean(text), 46, doc.y, { width, lineGap: 3 });
      doc.y += gap;
    };
    const heading = text => { room(70); paragraph(text, { size: 15, bold: true, color: '#c8323d', gap: 12 }); };
    const date = value => value.split('-').reverse().join('/');
    paragraph('CHARGEGRID HUB / RELATÓRIO DE OPERAÇÃO', { size: 9, bold: true, color: '#c8323d', gap: 13 });
    paragraph('Análise da operação', { size: 24, bold: true, color: '#182330', gap: 14 });
    paragraph(`Período: ${date(report.period.start)} a ${date(report.period.end)}`);
    paragraph(`Gerado em: ${new Date(report.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (São Paulo)`);
    paragraph(report.mode === 'ai' ? `Análise calculada pelo sistema | Dados organizados com Ollama / ${report.model}` : 'Análise calculada pelo sistema | Organização padrão - sem IA', { bold: true });
    if (report.warning) paragraph(report.warning, { color: '#945c10' });
    heading('Números do período');
    for (const id of ['sessions', 'energy', 'cost', 'sems']) {
      const f = report.facts.find(f => f.id === id);
      if (!f) continue;
      room(height(`${f.label}: ${f.value}`, 11, true) + height(f.source, 9) + 18);
      paragraph(`${f.label}: ${f.value}`, { size: 11, bold: true, gap: 3 });
      paragraph(f.source, { size: 9, color: '#687382', gap: 10 });
    }
    heading('Análise dos registros');
    paragraph(report.summary);
    for (const o of report.observations) {
      room(height(o.title, 11, true) + height(o.analysis) + 30);
      paragraph(o.title, { size: 11, bold: true });
      paragraph(o.analysis);

    }
    doc.addPage();
    heading('Dados utilizados na análise');
    for (const section of report.sections) {
      room(65);
      paragraph(section.title, { size: 12, bold: true, gap: 9 });
      for (const id of section.factIds) {
        const f = report.facts.find(f => f.id === id);
        if (!f) continue;
        room(height(`${f.label}: ${f.value}`, 10, true) + height(f.source, 8) + 10);
        paragraph(`${f.label}: ${f.value}`, { bold: true, gap: 1 });
        paragraph(f.source, { size: 8, color: '#687382', gap: 5 });
      }
    }
    heading('Limites da análise');
    for (const gap of new Set(report.limitations)) paragraph(`- ${gap}`, { size: 9, gap: 5 });
    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index++) {
      doc.switchToPage(index);
      doc.save();
      // Decoração fora da área de conteúdo, sem disparar uma página adicional.
      doc.page.margins.bottom = 0;
      doc.strokeColor('#e1e5ea').moveTo(46, 37).lineTo(doc.page.width - 46, 37).stroke();
      style(8, false, '#687382').text('ChargeGrid Hub | Relatório de operação', 46, 24, { width, align: 'left', lineBreak: false });
      doc.moveTo(46, doc.page.height - 36).lineTo(doc.page.width - 46, doc.page.height - 36).stroke();
      style(8, false, '#687382').text(`Documento gerado em ${new Date(report.generatedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} | ${index + 1} / ${pages.count}`, 46, doc.page.height - 25, { width, align: 'right', lineBreak: false });
      doc.restore();
    }
    doc.end();
  });
}

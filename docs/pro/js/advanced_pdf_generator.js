// ═══════════════════════════════════════════════════════════════════════
// ADVANCED PDF GENERATOR - 3-Tier Export System (Simple/Detailed/Internal)
// ═══════════════════════════════════════════════════════════════════════

window.exportAdvancedEstimatePDF = function(type) {
  const est = window.advancedEstimate;
  
  if (!est.lineItems || est.lineItems.length === 0) {
    if(typeof showToast==='function') showToast('No line items to export','error'); else alert('No line items to export');
    return;
  }
  
  // Create jsPDF instance
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  
  let yPos = 20;
  
  // ─────── HEADER (NBD Branding) ───────
  doc.setFillColor(200, 84, 26); // NBD Orange
  doc.rect(0, 0, pageWidth, 35, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('NO BIG DEAL', 15, 18);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Home Solutions', 15, 25);
  
  // Contact info (right side)
  doc.setFontSize(9);
  doc.text('(513) 555-0100', pageWidth - 15, 15, { align: 'right' });
  doc.text('joe@nobigdeal.com', pageWidth - 15, 20, { align: 'right' });
  doc.text('Cincinnati, OH', pageWidth - 15, 25, { align: 'right' });
  
  yPos = 45;
  
  // ─────── ESTIMATE INFO BOX ───────
  doc.setTextColor(0, 0, 0);
  doc.setFillColor(249, 249, 249);
  doc.rect(15, yPos, pageWidth - 30, 35, 'F');
  doc.setDrawColor(200, 84, 26);
  doc.setLineWidth(0.5);
  doc.rect(15, yPos, pageWidth - 30, 35, 'S');
  
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('ESTIMATE', 20, yPos + 10);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Project: ${est.projectName}`, 20, yPos + 18);
  doc.text(`Structure: ${est.structure || 'Main House'}`, 20, yPos + 24);
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, yPos + 30);
  
  // Type badge
  const typeLabel = type === 'simple' ? 'SIMPLE' : type === 'detailed' ? 'DETAILED' : 'INTERNAL';
  const typeColor = type === 'simple' ? [40, 167, 69] : type === 'detailed' ? [14, 165, 233] : [239, 68, 68];
  doc.setFillColor(typeColor[0], typeColor[1], typeColor[2]);
  doc.rect(pageWidth - 50, yPos + 5, 35, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text(typeLabel, pageWidth - 32.5, yPos + 10, { align: 'center' });
  
  yPos += 45;
  
  // ─────── RENDER BASED ON TYPE ───────
  doc.setTextColor(0, 0, 0);
  
  if (type === 'simple') {
    yPos = renderSimplePDF(doc, est, yPos);
  } else if (type === 'detailed') {
    yPos = renderDetailedPDF(doc, est, yPos);
  } else if (type === 'internal') {
    // Add CONFIDENTIAL watermark
    doc.setTextColor(220, 220, 220);
    doc.setFontSize(60);
    doc.setFont('helvetica', 'bold');
    doc.text('CONFIDENTIAL', pageWidth / 2, pageHeight / 2, { 
      align: 'center', 
      angle: 45 
    });
    doc.setTextColor(0, 0, 0);
    
    yPos = renderInternalPDF(doc, est, yPos);
  }
  
  // ─────── TOTALS SECTION ───────
  yPos = renderTotalSection(doc, est, yPos, pageWidth, pageHeight);
  
  // ─────── FOOTER ───────
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text('No Big Deal Home Solutions | Licensed & Insured', pageWidth / 2, pageHeight - 10, { align: 'center' });
  
  // Get PDF as blob
  const pdfBlob = doc.output('blob');
  
  // Ask user: Download or Email?
  const filename = `NBD_${typeLabel}_${est.projectName.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
  
  const action = confirm(`PDF Generated: ${typeLabel}\n\nClick OK to EMAIL this estimate\nClick Cancel to DOWNLOAD only`);
  
  if (action) {
    // Email the estimate
    if (typeof emailEstimatePDF === 'function') {
      emailEstimatePDF(est, pdfBlob);
    } else {
      if(typeof showToast==='function') showToast('Email system not loaded — downloading instead','warning'); else alert('Email system not loaded. Downloading instead.');
      doc.save(filename);
    }
  } else {
    // Download the PDF
    doc.save(filename);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// SIMPLE PDF - Section Totals Only
// ─────────────────────────────────────────────────────────────────────────

function renderSimplePDF(doc, est, yPos) {
  const pageWidth = doc.internal.pageSize.getWidth();
  
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('ESTIMATE SUMMARY', 15, yPos);
  yPos += 10;
  
  // Group items by section and calculate totals
  const sectionTotals = {};
  est.lineItems.forEach(item => {
    if (!sectionTotals[item.section]) {
      sectionTotals[item.section] = 0;
    }
    sectionTotals[item.section] += item.total;
  });
  
  // Render section totals
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  Object.keys(sectionTotals).sort().forEach(section => {
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
    }
    
    doc.setFont('helvetica', 'bold');
    doc.text(section, 20, yPos);
    doc.text(`$${sectionTotals[section].toFixed(2)}`, pageWidth - 20, yPos, { align: 'right' });
    yPos += 8;
  });
  
  return yPos + 10;
}

// ─────────────────────────────────────────────────────────────────────────
// DETAILED PDF - All Line Items
// ─────────────────────────────────────────────────────────────────────────

function renderDetailedPDF(doc, est, yPos) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DETAILED ESTIMATE', 15, yPos);
  yPos += 10;
  
  // Group by section
  const sections = {};
  est.lineItems.forEach(item => {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  });
  
  // Render each section
  Object.keys(sections).sort().forEach(sectionName => {
    // Section header
    if (yPos > pageHeight - 40) {
      doc.addPage();
      yPos = 20;
    }
    
    doc.setFillColor(200, 84, 26);
    doc.rect(15, yPos - 5, pageWidth - 30, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(sectionName, 20, yPos);
    yPos += 10;
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    
    // Line items
    sections[sectionName].forEach(item => {
      if (yPos > pageHeight - 20) {
        doc.addPage();
        yPos = 20;
      }
      
      const itemLine = `${item.name} (${item.qty} ${item.unit} × $${item.sellPrice.toFixed(2)})`;
      doc.text(itemLine, 20, yPos);
      doc.text(`$${item.total.toFixed(2)}`, pageWidth - 20, yPos, { align: 'right' });
      yPos += 6;
    });
    
    yPos += 5;
  });
  
  return yPos + 5;
}

// ─────────────────────────────────────────────────────────────────────────
// INTERNAL PDF - Cost Breakdown + Margins
// ─────────────────────────────────────────────────────────────────────────

function renderInternalPDF(doc, est, yPos) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(239, 68, 68);
  doc.text('INTERNAL COST ANALYSIS - CONFIDENTIAL', 15, yPos);
  doc.setTextColor(0, 0, 0);
  yPos += 10;
  
  // Table headers
  doc.setFillColor(240, 240, 240);
  doc.rect(15, yPos, pageWidth - 30, 8, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('Item', 20, yPos + 5);
  doc.text('Qty', 85, yPos + 5);
  doc.text('Cost', 105, yPos + 5, { align: 'right' });
  doc.text('Sell', 130, yPos + 5, { align: 'right' });
  doc.text('Margin', 155, yPos + 5, { align: 'right' });
  doc.text('Profit', pageWidth - 20, yPos + 5, { align: 'right' });
  yPos += 10;
  
  // Group by section
  const sections = {};
  est.lineItems.forEach(item => {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  });
  
  let totalCost = 0;
  let totalProfit = 0;
  
  doc.setFont('helvetica', 'normal');
  
  Object.keys(sections).sort().forEach(sectionName => {
    // Section header
    if (yPos > pageHeight - 30) {
      doc.addPage();
      yPos = 20;
    }
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(sectionName, 20, yPos);
    yPos += 6;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    
    sections[sectionName].forEach(item => {
      if (yPos > pageHeight - 15) {
        doc.addPage();
        yPos = 20;
      }
      
      const costPrice = item.costPrice || 0;
      const laborCost = item.laborCost || 0;
      const totalItemCost = (costPrice + laborCost) * item.qty;
      const profit = item.total - totalItemCost;
      const margin = item.total > 0 ? ((profit / item.total) * 100) : 0;
      
      totalCost += totalItemCost;
      totalProfit += profit;
      
      // Truncate long names
      const itemName = item.name.length > 30 ? item.name.substring(0, 27) + '...' : item.name;
      
      doc.text(itemName, 20, yPos);
      doc.text(`${item.qty} ${item.unit}`, 85, yPos);
      doc.text(`$${totalItemCost.toFixed(2)}`, 105, yPos, { align: 'right' });
      doc.text(`$${item.total.toFixed(2)}`, 130, yPos, { align: 'right' });
      doc.text(`${margin.toFixed(1)}%`, 155, yPos, { align: 'right' });
      
      // Color-code profit
      if (profit > 0) {
        doc.setTextColor(40, 167, 69);
      } else if (profit < 0) {
        doc.setTextColor(239, 68, 68);
      }
      doc.text(`$${profit.toFixed(2)}`, pageWidth - 20, yPos, { align: 'right' });
      doc.setTextColor(0, 0, 0);
      
      yPos += 5;
    });
    
    yPos += 3;
  });
  
  // Summary box
  yPos += 5;
  if (yPos > pageHeight - 35) {
    doc.addPage();
    yPos = 20;
  }
  
  doc.setFillColor(255, 243, 205);
  doc.rect(15, yPos, pageWidth - 30, 25, 'F');
  doc.setDrawColor(255, 193, 7);
  doc.setLineWidth(1);
  doc.rect(15, yPos, pageWidth - 30, 25, 'S');
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('COST SUMMARY', 20, yPos + 7);
  doc.text(`Total Cost: $${totalCost.toFixed(2)}`, 20, yPos + 14);
  doc.text(`Total Revenue: $${est.total.toFixed(2)}`, 20, yPos + 20);
  
  const overallMargin = est.total > 0 ? ((totalProfit / est.total) * 100) : 0;
  doc.setTextColor(40, 167, 69);
  doc.setFontSize(11);
  doc.text(`Gross Profit: $${totalProfit.toFixed(2)} (${overallMargin.toFixed(1)}%)`, pageWidth - 20, yPos + 17, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  
  return yPos + 30;
}

// ─────────────────────────────────────────────────────────────────────────
// TOTAL SECTION - Rendered on all PDF types
// ─────────────────────────────────────────────────────────────────────────

function renderTotalSection(doc, est, yPos, pageWidth, pageHeight) {
  // Check if we need a new page
  if (yPos > pageHeight - 50) {
    doc.addPage();
    yPos = 20;
  }
  
  yPos += 5;
  
  // Totals box
  doc.setFillColor(249, 249, 249);
  doc.rect(pageWidth - 90, yPos, 75, 35, 'F');
  doc.setDrawColor(200, 84, 26);
  doc.setLineWidth(0.5);
  doc.rect(pageWidth - 90, yPos, 75, 35, 'S');
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Subtotal:', pageWidth - 85, yPos + 8);
  doc.text(`$${est.subtotal.toFixed(2)}`, pageWidth - 20, yPos + 8, { align: 'right' });
  
  doc.text('Tax (7%):', pageWidth - 85, yPos + 16);
  doc.text(`$${est.tax.toFixed(2)}`, pageWidth - 20, yPos + 16, { align: 'right' });
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('TOTAL:', pageWidth - 85, yPos + 28);
  doc.setTextColor(200, 84, 26);
  doc.text(`$${est.total.toFixed(2)}`, pageWidth - 20, yPos + 28, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  
  return yPos + 40;
}

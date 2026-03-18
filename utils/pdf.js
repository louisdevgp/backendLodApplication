// src/utils/pdf/generateDemandePaiementPDF.js
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { ToWords } = require('to-words');

const toWords = new ToWords({
  localeCode: 'fr-FR',
  converterOptions: {
    currency: true,
    ignoreDecimal: false,
    ignoreZeroCurrency: false,
    doNotAddOnly: false,
    currencyOptions: {
      // can be used to override defaults for the selected locale
      name: 'Franc CFA',
      plural: 'Francs CFA',
      symbol: 'FCFA',
    },
  },
});

const montant_lettres = (num) => {
  if (num == null || isNaN(num)) return '';
  return toWords.convert(num);
}

/** Sécurise l'injection dans le HTML */
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Remplacement des {{placeholders}} */
function renderTemplate(tpl, data) {
  return tpl.replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => escapeHtml(data[key] ?? ""));
}

/** Format 1 234 567 en fr-FR */
function formatNumber(n) {
  const num = Number(n) || 0;
  return new Intl.NumberFormat("fr-FR").format(num);
}

/**
 * Génère le PDF de la demande (1 exemplaire/page)
 * @param {object} demande - Objet Prisma demandes_paiement
 * @param {string} outputPath - Chemin de sortie du PDF
 * @param {object} [opts]
 * @param {string} [opts.templatePath] - chemin HTML alternatif
 */
async function generateDemandePaiementPDF(demande, outputPath, opts = {}) {
  // 1) Mapping → placeholders
  const data = {
    montant: formatNumber(demande.montant ?? demande.montant_total ?? 0),
    montant_lettres: montant_lettres(demande.montant ?? demande.montant_total ?? 0),
    motif: demande.motif || "",
    beneficiaire: demande.beneficiaire || "",
    note: demande.nbMentionSection || demande.note || "",

    // signatures / approbations
    approbation_dg: demande.approbation_dg || "",
    approbation_dga: demande.approbation_dga || "",
    approbation_daf: demande.approbation_daf || "",
    signature: demande.signature || "",
    beneficiaire_signature: demande.beneficiaire_signature || "",

    // banque
    banque: demande.banque || "",
    num_cheque: demande.num_cheque || "",
    date_cheque: demande.date_cheque || "",
    compte_debite: demande.compte_debite || "",
    numero_piece: demande.numero_piece || "",
  };

  // 2) Charger le template HTML
  const defaultTpl = path.resolve(__dirname, "../public/tempate/template.html");
  const templatePath = opts.templatePath || defaultTpl;
  const templateHtml = fs.readFileSync(templatePath, "utf8");
  const html = renderTemplate(templateHtml, data);

  // 3) Lancer Chromium & préparer la page
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });

    // Attendre images & polices
    await page.evaluate(async () => {
      const imgs = Array.from(document.images);
      await Promise.all(
        imgs.map((i) => (i.complete ? null : new Promise((res) => { i.onload = i.onerror = res; })))
      );
      if (document.fonts && document.fonts.ready) { await document.fonts.ready; }
    });

    // 4) Générer le PDF (laisse @page gérer les marges)
    await page.pdf({
      path: outputPath,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }
}

module.exports = generateDemandePaiementPDF;

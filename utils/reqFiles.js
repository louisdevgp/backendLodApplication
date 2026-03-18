// utils/reqFiles.js
/**
 * Récupère tous les fichiers proformas d'une requête multipart,
 * en tolérant plusieurs clés: proformas, proformas[], proforma, upload.any()
 */
function collectProformaFilesFromReq(req) {
  const out = [];
  const names = new Set(["proformas", "proformas[]", "proforma"]);
  if (Array.isArray(req.files)) {
    // upload.any()
    for (const f of req.files) {
      if (!f?.fieldname || names.has(f.fieldname)) out.push(f);
    }
  } else if (req.files && typeof req.files === "object") {
    for (const key of Object.keys(req.files)) {
      if (names.has(key)) {
        const arr = Array.isArray(req.files[key]) ? req.files[key] : [req.files[key]];
        out.push(...arr);
      }
    }
  } else if (req.file && (names.has(req.file.fieldname) || !req.file.fieldname)) {
    out.push(req.file);
  }
  return out;
}

module.exports = { collectProformaFilesFromReq };

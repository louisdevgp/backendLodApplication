const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { collectProformaFilesFromReq } = require("../../utils/reqFiles");
const { parseId } = require("../../utils/parse");
const { asyncHandler } = require("../../utils/http");
const { uploadBuffer } = require("../../utils/cloudinary"); 



const ajouterProformas=  asyncHandler(async (req, res) => {
  const demandeId = parseId(req.params.id);
  if (!demandeId) return res.status(400).json({ message: "Paramètre id invalide." });

  const existe = await prisma.demandes_paiement.findUnique({
    where: { id: demandeId },
    select: { id: true },
  });
  if (!existe) return res.status(404).json({ message: "Demande non trouvée." });

  const files = collectProformaFilesFromReq(req);
  if (!files.length) {
    return res.status(400).json({ message: "Aucun fichier reçu (clé 'proformas')." });
  }

  // Upload hors transaction
  const uploads = [];
  for (const f of files) {
    if (!f?.buffer) continue;
    const url = await uploadBuffer(f.buffer, f.originalname || "proforma");
    uploads.push({ url, name: f.originalname || null });
  }

  await prisma.$transaction(async (tx) => {
    await tx.proformas.createMany({
      data: uploads.map((u) => ({
        demande_id: demandeId,
        fichier: u.url,
        date_ajout: new Date(),
        // nom: u.name, // si ta colonne existe
      })),
    });
  });

  const updated = await prisma.demandes_paiement.findUnique({
    where: { id: demandeId },
    include: { proformas: true },
  });

  return res.status(201).json({ message: "Proformas ajoutées.", proformas: updated.proformas });
});


const listerProformas = asyncHandler(async (req, res) => {
  const demandeId = parseId(req.params.id);
  if (!demandeId) return res.status(400).json({ message: "Paramètre id invalide." });

  const demande = await prisma.demandes_paiement.findUnique({
    where: { id: demandeId },
    include: { proformas: true },
  });
  if (!demande) return res.status(404).json({ message: "Demande non trouvée." });

  return res.status(200).json({ proformas: demande.proformas });
});


/**
 * DELETE /proformas/:proformaId
 */
const supprimerProforma = asyncHandler(async (req, res) => {
  const proformaId = parseId(req.params.proformaId);
  if (!proformaId) return res.status(400).json({ message: "Paramètre proformaId invalide." });

  const pf = await prisma.proformas.findUnique({
    where: { id: proformaId },
    select: { id: true, fichier: true },
  });
  if (!pf) return res.status(404).json({ message: "Proforma introuvable." });

  await prisma.proformas.delete({ where: { id: proformaId } });

  // suppression distante non bloquante
  if (pf.fichier) {
    deleteByUrl(pf.fichier).catch((e) =>
      console.warn("Suppression distante échouée (non bloquant):", e?.message || e)
    );
  }

  return res.status(200).json({ message: "Proforma supprimée." });
});


module.exports = {
    ajouterProformas,
    listerProformas,
    supprimerProforma
}



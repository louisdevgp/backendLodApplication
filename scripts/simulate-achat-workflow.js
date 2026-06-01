/*
  Simulate purchase request routing by requester profile.

  This script is for workflow verification, not a unit test.
  It creates real requests on the configured API, so it is guarded by SIMULATION_CONFIRM=YES.

  What it checks:
  1. Agent creates a request -> validation_section
     Section validates -> validation_entite
     Entite validates -> validation_entite_generale
     STOP: PDF must be printed and signed manually by DG outside the app.

  2. Responsable de section creates a request -> validation_entite
     Entite validates -> validation_entite_generale
     STOP: manual DG signature.

  3. Responsable d'entite creates a request -> validation_entite_generale directly
     STOP: manual DG signature.

  Optional continuation for one request:
  - Upload signed file URL -> en_attente_paiement
  - Mark paid -> paye
  - Buyer confirms purchase -> achat_effectue

  Required env vars for routing test:
    SIMULATION_CONFIRM=YES
    SIM_BASE_URL=http://localhost:5000/api
    SIM_AGENT_EMAIL=...
    SIM_AGENT_PASSWORD=...
    SIM_SECTION_EMAIL=...
    SIM_SECTION_PASSWORD=...
    SIM_ENTITE_EMAIL=...
    SIM_ENTITE_PASSWORD=...

  Optional continuation env vars:
    SIM_CONTINUE_AFTER_DG_SIGNATURE=YES
    SIM_PAYMENT_USER_EMAIL=...       defaults to SIM_ENTITE_EMAIL if omitted
    SIM_PAYMENT_USER_PASSWORD=...    defaults to SIM_ENTITE_PASSWORD if omitted
    SIM_ACHETEUR_EMAIL=...
    SIM_ACHETEUR_PASSWORD=...

  Optional request data:
    SIM_MONTANT=125000
    SIM_BENEFICIAIRE=Fournisseur Test
    SIM_TEST_DOC_URL=https://res.cloudinary.com/demo/image/upload/sample.jpg
*/

const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.SIM_BASE_URL || "http://localhost:5000/api";
const CONFIRM = process.env.SIMULATION_CONFIRM === "YES";
const CONTINUE_AFTER_DG_SIGNATURE = process.env.SIM_CONTINUE_AFTER_DG_SIGNATURE === "YES";
const TEST_DOC_URL = process.env.SIM_TEST_DOC_URL || "https://res.cloudinary.com/demo/image/upload/sample.jpg";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

async function request(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const msg = data?.message || data?.error || response.statusText;
    throw new Error(`${options.method || "GET"} ${pathname} failed (${response.status}): ${msg}`);
  }
  return data;
}

async function login(label, email, password) {
  const data = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, mot_de_passe: password }),
  });

  const user = data.user;
  if (!user?.id || !user?.agents?.id) {
    throw new Error(`${label}: login ok but user/agent id missing`);
  }

  console.log(`[OK] ${label}: user=${user.id}, agent=${user.agents.id}, fonction=${user.agents.fonction || "-"}, roles=${(user.roles || []).join(",") || "-"}`);
  return { token: data.token, user, label };
}

function authHeaders(session) {
  return { Authorization: `Bearer ${session.token}` };
}

async function createDemande(requesterSession, label) {
  const form = new FormData();
  form.append("agent_id", String(requesterSession.user.agents.id));
  form.append("montant", String(process.env.SIM_MONTANT || 125000));
  form.append("beneficiaire", process.env.SIM_BENEFICIAIRE || "Fournisseur Test Simulation");
  form.append("motif", `${label} - simulation parcours achat ${new Date().toISOString()}`);
  form.append("requiert_proforma", "false");

  const data = await request("/demandes/createDemandePaiement", {
    method: "POST",
    headers: authHeaders(requesterSession),
    body: form,
  });

  console.log(`[OK] ${label}: demande #${data.demande.id} creee, statut=${data.demande.statut}`);
  return data.demande;
}

async function getDemande(id, session) {
  const data = await request(`/demandes/getDemandePaiementById/${id}`, {
    headers: authHeaders(session),
  });
  return data.demande;
}

function assertStatus(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected statut=${expected}, got ${actual}`);
  }
  console.log(`[CHECK] ${label}: statut=${actual}`);
}

async function validateDemande(id, validatorSession, label, expectedAfter) {
  const form = new FormData();
  form.append("valideur_id", String(validatorSession.user.id));
  form.append("statut", "approuve");
  form.append("commentaire", `Validation simulation - ${label}`);

  await request(`/validations/${id}/valider`, {
    method: "POST",
    headers: authHeaders(validatorSession),
    body: form,
  });

  const updated = await getDemande(id, validatorSession);
  assertStatus(updated.statut, expectedAfter, label);
  return updated;
}

async function updateStatus(id, session, fields, label, expectedAfter) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));

  await request(`/demandes/modifyDemandePaiement/${id}`, {
    method: "PUT",
    headers: authHeaders(session),
    body: form,
  });

  const updated = await getDemande(id, session);
  assertStatus(updated.statut, expectedAfter, label);
  return updated;
}

async function effectuerAchat(id, buyerSession) {
  const form = new FormData();
  form.append("commentaire", "Achat effectue via simulation API");

  const proofPath = path.join(__dirname, "simulation-preuve-achat.txt");
  fs.writeFileSync(proofPath, `Preuve achat simulation demande #${id}\n${new Date().toISOString()}\n`);
  const buffer = fs.readFileSync(proofPath);
  const blob = new Blob([buffer], { type: "text/plain" });
  form.append("preuves", blob, "simulation-preuve-achat.txt");

  await request(`/achats/${id}/effectuer`, {
    method: "POST",
    headers: authHeaders(buyerSession),
    body: form,
  });

  const updated = await getDemande(id, buyerSession);
  assertStatus(updated.statut, "achat_effectue", "Achat effectue");
  return updated;
}

async function runRoutingScenarios(sessions) {
  const { agent, section, entite } = sessions;

  const agentDemande = await createDemande(agent, "Scenario Agent");
  assertStatus(agentDemande.statut, "validation_section", "Agent -> creation");
  await validateDemande(agentDemande.id, section, "Section valide demande Agent", "validation_entite");
  await validateDemande(agentDemande.id, entite, "Entite valide demande Agent", "validation_entite_generale");
  console.log(`[STOP] Demande #${agentDemande.id}: imprimer le PDF et faire signer manuellement par le DG.`);

  const sectionDemande = await createDemande(section, "Scenario Responsable section");
  assertStatus(sectionDemande.statut, "validation_entite", "Responsable section -> creation");
  await validateDemande(sectionDemande.id, entite, "Entite valide demande Responsable section", "validation_entite_generale");
  console.log(`[STOP] Demande #${sectionDemande.id}: imprimer le PDF et faire signer manuellement par le DG.`);

  const entiteDemande = await createDemande(entite, "Scenario Responsable entite");
  assertStatus(entiteDemande.statut, "validation_entite_generale", "Responsable entite -> creation directe");
  console.log(`[STOP] Demande #${entiteDemande.id}: imprimer le PDF et faire signer manuellement par le DG.`);

  return { agentDemande, sectionDemande, entiteDemande };
}

async function continueAfterManualSignature(demandeId, sessions) {
  const paymentUserEmail = process.env.SIM_PAYMENT_USER_EMAIL || process.env.SIM_ENTITE_EMAIL;
  const paymentUserPassword = process.env.SIM_PAYMENT_USER_PASSWORD || process.env.SIM_ENTITE_PASSWORD;
  const paymentUser = await login("Utilisateur upload/paiement", paymentUserEmail, paymentUserPassword);
  const acheteur = await login("Acheteur", required("SIM_ACHETEUR_EMAIL"), required("SIM_ACHETEUR_PASSWORD"));

  await updateStatus(
    demandeId,
    paymentUser,
    {
      statut: "en_attente_paiement",
      documents: TEST_DOC_URL,
      types: "signe_reg",
    },
    "Upload fiche signee apres signature DG",
    "en_attente_paiement"
  );

  await updateStatus(
    demandeId,
    paymentUser,
    {
      statut: "paye",
      paiements: JSON.stringify([
        {
          moyen_paiement: "cheque",
          documents: [{ url: TEST_DOC_URL, type: "preuve_paiement" }],
        },
      ]),
    },
    "Paiement",
    "paye"
  );

  await effectuerAchat(demandeId, acheteur);
}

async function main() {
  if (!CONFIRM) {
    throw new Error("Refusing to run. Set SIMULATION_CONFIRM=YES and use test accounts/test database.");
  }

  console.log(`[INFO] Target API: ${BASE_URL}`);

  const sessions = {
    agent: await login("Agent", required("SIM_AGENT_EMAIL"), required("SIM_AGENT_PASSWORD")),
    section: await login("Responsable section", required("SIM_SECTION_EMAIL"), required("SIM_SECTION_PASSWORD")),
    entite: await login("Responsable entite", required("SIM_ENTITE_EMAIL"), required("SIM_ENTITE_PASSWORD")),
  };

  const created = await runRoutingScenarios(sessions);

  if (CONTINUE_AFTER_DG_SIGNATURE) {
    console.log(`[INFO] Continuation post-signature DG sur demande #${created.entiteDemande.id}`);
    await continueAfterManualSignature(created.entiteDemande.id, sessions);
  } else {
    console.log("[INFO] Continuation paiement/achat ignoree. Set SIM_CONTINUE_AFTER_DG_SIGNATURE=YES pour tester apres signature DG.");
  }

  console.log("[DONE] Simulation terminee.");
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});

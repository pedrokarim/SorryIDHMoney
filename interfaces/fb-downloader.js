// by @AliasPedroKarim
// Écran de la file Facebook : consulter, exporter, nettoyer.
//
// Aucune URL de CDN ici — la file ne garde que des URL de pages, qui restent
// valables. C'est yt-dlp qui ré-extraira le média au moment du téléchargement.

import {
  lireFile,
  retirerDeFile,
  viderFile,
} from "../scripts/facebook-queue.js";
import { estTitreGenerique } from "../scripts/facebook-extract.js";

const COMMANDE =
  'yt-dlp --cookies-from-browser chrome -a lives.txt ' +
  '-o "%(upload_date)s - %(title)s.%(ext)s"';

const liste = document.getElementById("liste");
const etat = document.getElementById("etat");
const caseEntete = document.getElementById("case-entete");

document.getElementById("apercu-commande").textContent = COMMANDE;

let file = [];

function formaterDuree(ms) {
  if (!ms) return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

function dire(message) {
  etat.textContent = message;
}

function selection() {
  return [...liste.querySelectorAll("input[type=checkbox]:checked")].map(
    (c) => c.dataset.id
  );
}

function videosSelectionnees() {
  const ids = new Set(selection());
  const choisies = file.filter((v) => ids.has(v.id));
  return choisies.length ? choisies : file;
}

function afficher() {
  liste.innerHTML = "";

  if (!file.length) {
    liste.innerHTML =
      '<tr><td colspan="6" class="fb-vide">La file est vide. Les vidéos ' +
      "ajoutées depuis facebook.com apparaîtront ici.</td></tr>";
    dire("");
    return;
  }

  for (const video of file) {
    const ligne = document.createElement("tr");

    const etiquette = video.progressif
      ? '<span class="fb-etiquette fb-etiquette-direct">mp4 direct</span>'
      : '<span class="fb-etiquette fb-etiquette-ytdlp">yt-dlp</span>';

    ligne.innerHTML = `
      <td><input type="checkbox" data-id="${video.id}"></td>
      <td>${echapper(
        estTitreGenerique(video.titre) ? `Vidéo ${video.id}` : video.titre
      )}</td>
      <td>${video.dateIso || "—"}</td>
      <td>${formaterDuree(video.dureeMs)}</td>
      <td>${etiquette}</td>
      <td><a href="${echapper(video.url)}" target="_blank" rel="noreferrer">ouvrir</a></td>
    `;
    liste.appendChild(ligne);
  }

  dire(`${file.length} vidéo${file.length > 1 ? "s" : ""} en file.`);
}

function echapper(s) {
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

async function recharger() {
  file = await lireFile();
  caseEntete.checked = false;
  afficher();
}

function telechargerTexte(nom, contenu) {
  const url = URL.createObjectURL(new Blob([contenu], { type: "text/plain" }));
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  lien.click();
  URL.revokeObjectURL(url);
}

async function copier(texte, message) {
  await navigator.clipboard.writeText(texte);
  dire(message);
}

// --- Actions --------------------------------------------------------------

caseEntete.addEventListener("change", () => {
  liste
    .querySelectorAll("input[type=checkbox]")
    .forEach((c) => (c.checked = caseEntete.checked));
});

document.getElementById("tout-cocher").addEventListener("click", () => {
  caseEntete.checked = true;
  caseEntete.dispatchEvent(new Event("change"));
});

document.getElementById("exporter").addEventListener("click", () => {
  const videos = videosSelectionnees();
  if (!videos.length) return dire("Rien à exporter.");
  telechargerTexte("lives.txt", videos.map((v) => v.url).join("\n") + "\n");
  dire(`lives.txt exporté (${videos.length} URL).`);
});

document.getElementById("copier-commande").addEventListener("click", () => {
  copier(COMMANDE, "Commande copiée.");
});

document.getElementById("copier-urls").addEventListener("click", () => {
  const videos = videosSelectionnees();
  if (!videos.length) return dire("Rien à copier.");
  copier(
    videos.map((v) => v.url).join("\n"),
    `${videos.length} URL copiée${videos.length > 1 ? "s" : ""}.`
  );
});

document.getElementById("retirer").addEventListener("click", async () => {
  const ids = selection();
  if (!ids.length) return dire("Aucune ligne cochée.");
  await retirerDeFile(ids);
  await recharger();
  dire(`${ids.length} entrée${ids.length > 1 ? "s" : ""} retirée${ids.length > 1 ? "s" : ""}.`);
});

document.getElementById("vider").addEventListener("click", async () => {
  if (!confirm("Vider toute la file ?")) return;
  await viderFile();
  await recharger();
});

recharger();

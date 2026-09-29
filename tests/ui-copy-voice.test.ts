import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// User-facing Spanish speaks to the user as vos ("Revisá", "tenés"), never
// as tú (DESIGN.md, "Content conventions"). These catch the tú forms that
// have no vos reading; "te", "tu" and subjunctives such as "no cierres" are
// shared by both and stay.

const root = process.cwd();
const copyDirectories = ["app", "components", "lib", "emails"];

function sourceFiles() {
  return copyDirectories.flatMap((directory) =>
    readdirSync(path.join(root, directory), { recursive: true })
      .map(String)
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => path.join(directory, file))
  );
}

/**
 * The source without comments, which are in English and not user copy. Block
 * comments keep their line breaks so line numbers still match the file.
 */
function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ""))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

// Present tense and pronouns: the vos forms are "tenés", "podés", "vos"…
const tuWords =
  /(?<!\p{L})(?:tienes|puedes|quieres|necesitas|debes|eres|sabes|perteneces|tú|has \p{L}+(?:ado|ido))(?!\p{L})/iu;

// Imperatives with a pronoun attached keep the tú stress mark ("Inténtalo");
// the vos forms have none ("Intentalo", "Conectate").
const tuImperativesWithPronoun =
  /(?<!\p{L})(?:[Ii]nténtalo|[Cc]ópialo|[Dd]escárgalo|[Cc]onéctate|[Cc]ompártelo|[Dd]éjalo|[Ee]scríbelas?|[Rr]esuélvelas?|[Dd]escártalas?|Únete|[Aa]segúrate|Mantén)(?!\p{L})/u;

// A tú imperative that opens a sentence ("Revisa la conexión"). In the middle
// of one the same words are usually third person ("la subida se reintenta").
const tuImperativeOpeningSentence =
  /(?:^\s*|["'`>]|[.!?:]\s)(?:Abre|Activa|Agrega|Busca|Cierra|Comparte|Confirma|Configura|Consulta|Crea|Descarga|Edita|Elige|Escribe|Espera|Fuerza|Guarda|Ingresa|Inicia|Intenta|Pide|Prueba|Recarga|Reintenta|Revisa|Selecciona|Toca|Usa|Verifica|Vuelve)(?:\s+\p{L}|…)/mu;

test("user-facing copy uses vos, not tú", () => {
  const offending: string[] = [];
  for (const file of sourceFiles()) {
    const source = withoutComments(readFileSync(path.join(root, file), "utf8"));
    for (const [index, line] of source.split("\n").entries()) {
      if (
        tuWords.test(line) ||
        tuImperativesWithPronoun.test(line) ||
        tuImperativeOpeningSentence.test(line)
      ) {
        offending.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offending, []);
});

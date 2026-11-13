// OWNER / LAWYER INPUT NEEDED. Every fact about the operator that the terms
// of service (app/terminos) and the privacy policy (app/privacidad) cannot
// derive from the code lives here, as an obvious bracketed placeholder. Do
// not ship to the public with any of them unfilled: the pages show a "draft"
// notice while one is left (legalPlaceholdersLeft), and both texts, filled
// in, still need a lawyer's review before launch.
//
// Each value is plain Spanish text shown as is in the pages. Keep the vos
// form in anything addressed to the user (tests/ui-copy-voice.test.ts).

export const legalOperator = {
  /**
   * TODO(owner): the legal name of whoever operates Billetera Ferial (a
   * person or a company) and, if it applies, its tax id (NIT).
   */
  legalName: "[NOMBRE LEGAL DEL OPERADOR Y NIT]",
  /** TODO(owner): a postal address where the operator can be reached. */
  postalAddress: "[DIRECCIÓN POSTAL DEL OPERADOR]",
  /**
   * TODO(owner): the email address for legal and privacy requests. It can be
   * the same as NEXT_PUBLIC_SUPPORT_EMAIL, but the pages do not assume so.
   */
  contactEmail: "[CORREO DE CONTACTO LEGAL Y DE PRIVACIDAD]",
  /**
   * TODO(lawyer): the law that governs the terms and the courts that settle
   * disputes, e.g. "las leyes del Estado Plurinacional de Bolivia" and a
   * city's courts.
   */
  governingLaw: "[LEY APLICABLE]",
  jurisdiction: "[TRIBUNALES COMPETENTES]",
  /**
   * TODO(owner + lawyer): how long sales, products, stock and team data are
   * kept once a puesto stops being used or its owner deletes the account,
   * and how long backups keep them after that.
   */
  dataRetention:
    "[PLAZO DE CONSERVACIÓN DE LOS DATOS DEL PUESTO Y DE LAS COPIAS DE SEGURIDAD]",
  /**
   * TODO(owner): how long Sentry keeps error reports under the plan in use
   * (see the project's data retention settings).
   */
  errorReportRetention: "[PLAZO DE CONSERVACIÓN DE LOS REPORTES DE ERRORES]",
  /**
   * TODO(owner): how a user asks for access to, correction or deletion of
   * their data, or deletes their account. Update it when in-app account
   * deletion ships.
   */
  deletionRequest:
    "[CÓMO PEDIR EL ACCESO, LA CORRECCIÓN O LA ELIMINACIÓN DE TUS DATOS, O ELIMINAR TU CUENTA]",
  /**
   * TODO(owner): whether the service is free or paid, and if paid, the
   * prices, how they are charged and how to cancel.
   */
  pricing: "[SI EL SERVICIO ES GRATUITO O TIENE COSTO, Y CÓMO SE COBRA]",
  /**
   * TODO(owner + lawyer): the minimum age to use the service, if any.
   */
  minimumAge: "[EDAD MÍNIMA PARA USAR EL SERVICIO]",
  /** TODO(owner): the date the reviewed texts take effect, e.g. "1 de diciembre de 2026". */
  lastUpdated: "[FECHA DE ÚLTIMA ACTUALIZACIÓN]",
} as const;

export type LegalOperatorField = keyof typeof legalOperator;

/** A value still left as its bracketed placeholder. */
export function isLegalPlaceholder(value: string) {
  return /^\[[^]*\]$/.test(value.trim());
}

/** The fields still to fill in, for the pages' draft notice and the tests. */
export function legalPlaceholdersLeft(
  values: Record<string, string> = legalOperator
): string[] {
  return Object.entries(values)
    .filter(([, value]) => isLegalPlaceholder(value))
    .map(([field]) => field);
}

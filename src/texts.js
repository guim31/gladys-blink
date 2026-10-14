// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, the reports of the Configuration actions, the errors of
// the scene actions and widget buttons. Four languages, the four of the
// Gladys interface; German says "du", Spanish "usted". test/i18n.test.js
// checks every table. The action names quoted here are the manifest labels.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './blink/errors.js';

export const LANGUAGE_FALLBACK = 'en';
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// The connection status of the Configuration screen.
export const CONNECTION_TEXT = {
  noCredentials: {
    en: 'Enter the e-mail address and the password of your Blink account, then save.',
    fr: "Saisissez l'adresse e-mail et le mot de passe de votre compte Blink, puis enregistrez.",
    de: 'Gib die E-Mail-Adresse und das Passwort deines Blink-Kontos ein und speichere.',
    es: 'Introduzca la dirección de correo y la contraseña de su cuenta Blink y guarde.',
  },
  codeRequired: {
    en: 'Blink sent you a verification code: type it in the "Enter the code" action.',
    fr: 'Blink vous a envoyé un code de vérification : saisissez-le dans l’action « Saisir le code ».',
    de: 'Blink hat dir einen Bestätigungscode geschickt: Gib ihn in der Aktion „Code eingeben“ ein.',
    es: 'Blink le ha enviado un código de verificación: introdúzcalo en la acción «Introducir el código».',
  },
  signIn: {
    en: 'Not signed in to Blink: use the "Sign in" action.',
    fr: 'Non connecté à Blink : utilisez l’action « Se connecter ».',
    de: 'Nicht bei Blink angemeldet: Verwende die Aktion „Anmelden“.',
    es: 'Sin sesión en Blink: use la acción «Iniciar sesión».',
  },
};

// One short explanation per error kind (src/blink/errors.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the Blink cloud does not answer, retrying later',
    fr: 'le cloud Blink ne répond pas, nouvel essai plus tard',
    de: 'die Blink-Cloud antwortet nicht, neuer Versuch später',
    es: 'la nube de Blink no responde, se reintentará más tarde',
  },
  [ERROR_KINDS.CREDENTIALS]: {
    en: 'e-mail or password refused by Blink',
    fr: 'e-mail ou mot de passe refusé par Blink',
    de: 'E-Mail oder Passwort von Blink abgelehnt',
    es: 'correo o contraseña rechazados por Blink',
  },
  [ERROR_KINDS.CODE_INVALID]: {
    en: 'verification code refused: check it, or sign in again for a new one',
    fr: 'code de vérification refusé : vérifiez-le, ou reconnectez-vous pour en recevoir un autre',
    de: 'Bestätigungscode abgelehnt: Prüfe ihn oder melde dich neu an, um einen neuen zu erhalten',
    es: 'código de verificación rechazado: compruébelo o vuelva a iniciar sesión para recibir otro',
  },
  [ERROR_KINDS.NO_PENDING_LOGIN]: {
    en: 'no sign-in waits for a code: use "Sign in" first',
    fr: 'aucune connexion n’attend de code : utilisez d’abord « Se connecter »',
    de: 'keine Anmeldung wartet auf einen Code: Verwende zuerst „Anmelden“',
    es: 'ningún inicio de sesión espera un código: use primero «Iniciar sesión»',
  },
  [ERROR_KINDS.SESSION_EXPIRED]: {
    en: 'the Blink session has expired: use "Sign in"',
    fr: 'la session Blink a expiré : utilisez « Se connecter »',
    de: 'die Blink-Sitzung ist abgelaufen: Verwende „Anmelden“',
    es: 'la sesión de Blink ha caducado: use «Iniciar sesión»',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'Blink asks to slow down (too many requests), retrying later',
    fr: 'Blink demande de ralentir (trop de requêtes), nouvel essai plus tard',
    de: 'Blink bittet um weniger Anfragen, neuer Versuch später',
    es: 'Blink pide reducir las peticiones, se reintentará más tarde',
  },
  [ERROR_KINDS.LOGIN_FLOW]: {
    en: 'the Blink sign-in page changed: an update of the integration is needed',
    fr: 'la page de connexion Blink a changé : une mise à jour de l’intégration est nécessaire',
    de: 'die Anmeldeseite von Blink hat sich geändert: Die Integration muss aktualisiert werden',
    es: 'la página de inicio de sesión de Blink ha cambiado: hace falta actualizar la integración',
  },
  [ERROR_KINDS.COMMAND]: {
    en: 'the command did not complete on the Blink system',
    fr: 'la commande n’a pas abouti sur le système Blink',
    de: 'der Befehl wurde auf dem Blink-System nicht ausgeführt',
    es: 'la orden no se ha completado en el sistema Blink',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer from Blink, see the logs',
    fr: 'réponse inattendue de Blink, voir les logs',
    de: 'unerwartete Antwort von Blink, sieh in den Protokollen nach',
    es: 'respuesta inesperada de Blink, consulte los registros',
  },
};

// Reports of the Configuration actions ("Sign in", "Enter the code").
export const REPORT_TEXT = {
  en: {
    connected: (systems, cameras) =>
      `Signed in to Blink: ${systems} system(s), ${cameras} camera(s). Add them from the Discovery tab.`,
    codeSent: 'Blink sent a verification code (e-mail or SMS): type it in "Enter the code".',
    codeEmpty: 'Type the code received from Blink.',
    failed: (reason) => `Sign-in failed: ${reason}.`,
  },
  fr: {
    connected: (systems, cameras) =>
      `Connecté à Blink : ${systems} système(s), ${cameras} caméra(s). Ajoutez-les depuis l’onglet Découverte.`,
    codeSent:
      'Blink a envoyé un code de vérification (e-mail ou SMS) : saisissez-le dans « Saisir le code ».',
    codeEmpty: 'Saisissez le code reçu de Blink.',
    failed: (reason) => `Échec de la connexion : ${reason}.`,
  },
  de: {
    connected: (systems, cameras) =>
      `Bei Blink angemeldet: ${systems} System(e), ${cameras} Kamera(s). Füge sie im Tab „Erkennung“ hinzu.`,
    codeSent:
      'Blink hat einen Bestätigungscode geschickt (E-Mail oder SMS): Gib ihn in „Code eingeben“ ein.',
    codeEmpty: 'Gib den Code ein, den du von Blink erhalten hast.',
    failed: (reason) => `Anmeldung fehlgeschlagen: ${reason}.`,
  },
  es: {
    connected: (systems, cameras) =>
      `Sesión iniciada en Blink: ${systems} sistema(s), ${cameras} cámara(s). Añádalos desde la pestaña Descubrimiento.`,
    codeSent:
      'Blink ha enviado un código de verificación (correo o SMS): introdúzcalo en «Introducir el código».',
    codeEmpty: 'Introduzca el código recibido de Blink.',
    failed: (reason) => `Error al iniciar sesión: ${reason}.`,
  },
};

// Results and errors of the commands (scene actions, widget buttons).
export const COMMAND_TEXT = {
  en: {
    armed: (name) => `${name}: armed.`,
    disarmed: (name) => `${name}: disarmed.`,
    motionOn: (name) => `${name}: motion detection on.`,
    motionOff: (name) => `${name}: motion detection off.`,
    snapshot: (name) => `${name}: new image taken.`,
    tooSoon: (name, seconds) => `${name}: wait ${seconds} s before another image (battery).`,
    notConnected: 'Not signed in to Blink: see the Configuration screen of the integration.',
    unknown: 'This Blink device is unknown: search again in the Discovery tab.',
    failed: (reason) => `Blink did not apply the command: ${reason}.`,
  },
  fr: {
    armed: (name) => `${name} : armé.`,
    disarmed: (name) => `${name} : désarmé.`,
    motionOn: (name) => `${name} : détection de mouvement activée.`,
    motionOff: (name) => `${name} : détection de mouvement désactivée.`,
    snapshot: (name) => `${name} : nouvelle image prise.`,
    tooSoon: (name, seconds) => `${name} : attendez ${seconds} s avant une autre image (batterie).`,
    notConnected: 'Non connecté à Blink : voir l’écran Configuration de l’intégration.',
    unknown: 'Cet appareil Blink est inconnu : relancez une recherche dans l’onglet Découverte.',
    failed: (reason) => `Blink n’a pas appliqué la commande : ${reason}.`,
  },
  de: {
    armed: (name) => `${name}: scharf geschaltet.`,
    disarmed: (name) => `${name}: unscharf geschaltet.`,
    motionOn: (name) => `${name}: Bewegungserkennung an.`,
    motionOff: (name) => `${name}: Bewegungserkennung aus.`,
    snapshot: (name) => `${name}: neues Bild aufgenommen.`,
    tooSoon: (name, seconds) => `${name}: Warte ${seconds} s bis zum nächsten Bild (Batterie).`,
    notConnected: 'Nicht bei Blink angemeldet: Sieh dir die Konfiguration der Integration an.',
    unknown: 'Dieses Blink-Gerät ist unbekannt: Suche im Tab „Erkennung“ erneut.',
    failed: (reason) => `Blink hat den Befehl nicht ausgeführt: ${reason}.`,
  },
  es: {
    armed: (name) => `${name}: armado.`,
    disarmed: (name) => `${name}: desarmado.`,
    motionOn: (name) => `${name}: detección de movimiento activada.`,
    motionOff: (name) => `${name}: detección de movimiento desactivada.`,
    snapshot: (name) => `${name}: nueva imagen tomada.`,
    tooSoon: (name, seconds) => `${name}: espere ${seconds} s antes de otra imagen (batería).`,
    notConnected: 'Sin sesión en Blink: consulte la pantalla de configuración de la integración.',
    unknown: 'Este dispositivo Blink es desconocido: vuelva a buscar en la pestaña Descubrimiento.',
    failed: (reason) => `Blink no ha aplicado la orden: ${reason}.`,
  },
};

/** A multi-language object from a function of the language. */
export const allLanguages = (render) =>
  Object.fromEntries(Object.keys(REPORT_TEXT).map((language) => [language, render(language)]));

/** The reason of an error, in a language. */
export const reasonOf = (err, language) =>
  pick(ERROR_TEXT[err?.kind] ?? ERROR_TEXT[ERROR_KINDS.HTTP], language);

/** An Error whose message is the multi-language text, for a scene action or a toast. */
export class UserError extends Error {
  constructor(text, language) {
    super(pick(text, language));
    this.name = 'UserError';
    this.text = text;
  }
}

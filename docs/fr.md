# Blink

Cette intégration amène vos caméras et sonnettes **Blink** (Blink Outdoor 4, Blink Mini, Blink Video Doorbell,
avec ou sans Sync Module) dans Gladys, par le cloud Blink : armement de chaque système, dernière image de chaque
caméra, mouvement et sonnette dans vos scènes, et un widget pour le tableau de bord.

Sans lien avec Blink ni Amazon. Blink est une marque d’Amazon.com, Inc. ou de ses filiales.

> **Développée sans le matériel : vos retours sont les bienvenus.** Elle suit le protocole de la bibliothèque
> blinkpy (utilisée par Home Assistant) et de vraies réponses du cloud Blink publiées par d’autres projets, mais
> elle n’a jamais tourné sur un vrai compte Blink. Dites-nous ce qui marche et ce qui ne marche pas sur
> [GitHub](https://github.com/guim31/gladys-blink/issues).

## Prérequis

- Gladys 5.2.0 ou plus récent.
- Un compte Blink (l’adresse e-mail et le mot de passe de l’application Blink) avec au moins un système.
- Un accès Internet pour Gladys : tout passe par le cloud Blink, il n’y a pas d’accès local.
- L’accès à la boîte mail ou au téléphone du compte : Blink envoie un code de vérification à la première connexion.

## Configuration

### Connexion et code de vérification

1. Renseignez **Adresse e-mail** et **Mot de passe**, puis enregistrez.
2. Blink envoie un code de vérification par e-mail ou SMS : ouvrez l’action **Saisir le code**, tapez le code et
   lancez-la. Le message sous le bouton indique combien de systèmes et de caméras ont été trouvés.
3. Ajoutez les appareils depuis l’onglet **Découverte**.

Le code n’est demandé qu’une fois : l’intégration garde sa session dans `/data` et la renouvelle seule. Si la
session est refusée un jour (mot de passe changé, client supprimé dans l’application Blink), elle se reconnecte
seule, au plus une fois par heure ; quand Blink demande un nouveau code, l’écran Configuration l’indique. L’action
**Se connecter** relance la connexion à la demande.

### Intervalle de rafraîchissement

Fréquence de lecture du cloud Blink : 30 secondes, 1 minute (par défaut), 2 minutes ou 5 minutes. Une lecture,
ce sont deux requêtes au cloud Blink quel que soit le nombre de caméras, et **elle ne réveille jamais les
caméras** : leur batterie n’est pas touchée. L’intervalle est aussi le délai des événements de mouvement et de
sonnette. Blink bannit les clients trop bavards : 30 secondes est le minimum recommandé par blinkpy, et après une
réponse « trop de requêtes », l’intervalle est doublé un moment. La **Langue des noms** choisit les noms des
fonctionnalités des nouveaux appareils.

## Appareils

### Système

Un appareil par système Blink (Sync Module, ou une Mini ou une sonnette seule) :

- **Armement** : allumé quand le système est armé. En lecture seule sur l’appareil : armez et désarmez depuis le
  widget ou une scène (voir plus bas). C’est voulu : un interrupteur serait exposé à Google Home et Alexa par
  Gladys Plus, et « éteins tout » désarmerait vos caméras.
- **Sync Module en ligne** : le Sync Module répond-il à Blink (seulement pour un système avec Sync Module).

### Caméra, Mini et sonnette

Un appareil par caméra :

- **Image** : la dernière miniature de la caméra, envoyée à Gladys chaque fois que Blink en a une nouvelle. Quand
  Gladys demande une image (tableau de bord, chat), elle reçoit cette dernière miniature : **l’intégration ne prend
  jamais de photo d’elle-même**, car chaque capture réveille la caméra et consomme de la batterie. Une nouvelle
  image n’est prise qu’à votre demande (widget ou scène).
- **Mouvement détecté** : allumé pendant deux minutes après un clip de mouvement, éteint sinon.
- **Détection de mouvement activée** : la caméra enregistre-t-elle les mouvements quand son système est armé.
- **Température** (caméras sur batterie) : le capteur de la caméra, en °C, souvent dehors : tenu à l’écart de la
  moyenne de la pièce.
- **Batterie faible** (caméras sur batterie et sonnette) : Blink dit seulement « OK » ou « faible », pas un
  pourcentage.
- **Signal Wi-Fi** (caméras sur batterie et sonnette) : de 0 à 5 barres.
- **Sonnette** (Video Doorbell) : allumée pendant une lecture quand on appuie sur le bouton ; le tableau de bord
  affiche l’heure du dernier coup de sonnette.

## Widget

Le widget **Blink** affiche la dernière image de chaque caméra (avec une pastille pour un mouvement, une caméra
hors ligne ou une détection désactivée), l’état du système et trois boutons :

- **Armer** et **Désarmer** (le désarmement demande une confirmation) ; l’état actuel porte une coche ;
- **Nouvelle image…** ouvre un petit formulaire pour choisir la caméra, qui prend une nouvelle photo.

Avec plusieurs systèmes, choisissez le système dans les réglages du widget (un système, ou une de ses caméras) ;
sans choix, le widget affiche tous les systèmes, sans les boutons d’armement.

## Déclencheurs de scène

- **Blink : mouvement détecté** : une caméra a enregistré un clip de mouvement. Filtre : une caméra (vide :
  n’importe laquelle). Variables : le nom de la caméra et celui du système.
- **Blink : sonnette pressée** : quelqu’un a appuyé sur le bouton d’une Video Doorbell. Filtre : une sonnette
  (vide : n’importe laquelle).

Les deux arrivent avec le délai de l’intervalle de rafraîchissement, plus le temps que Blink met à envoyer le clip
(souvent 10 à 30 secondes). Blink n’enregistre que si le système est armé et la détection de la caméra activée.

## Actions de scène

- **Blink : armer ou désarmer** : arme ou désarme un système (choisissez le système ou une de ses caméras).
  Sortie : armé.
- **Blink : détection de mouvement** : active ou désactive la détection d’une caméra. Sortie : détection activée.
- **Blink : prendre une nouvelle image** : réveille la caméra pour une nouvelle image (cela consomme de la
  batterie), puis la publie sur l’appareil de la caméra. Au plus une par caméra et par minute. Sortie : image
  prise.

## Exemples de scènes

- **Suivre l’alarme de Gladys** : déclencheur « alarme armée » → **Blink : armer ou désarmer** (armer) ;
  déclencheur « alarme désarmée » → désarmer.
- **Qui sonne ?** : **Blink : sonnette pressée** → **Blink : prendre une nouvelle image** de la sonnette → l’action
  Gladys « envoyer une image de caméra » sur votre téléphone.
- **Lumière du jardin la nuit** : **Blink : mouvement détecté** (caméra du jardin) → condition « il fait nuit » →
  allumer la lumière du jardin.

## Dépannage

- **« Blink vous a envoyé un code de vérification »** : saisissez-le avec **Saisir le code**. Un code saisi plus de
  15 minutes après est refusé : lancez **Se connecter** pour en recevoir un nouveau.
- **« e-mail ou mot de passe refusé par Blink »** : vérifiez-les dans l’application Blink, puis enregistrez de
  nouveau la configuration.
- **« la page de connexion Blink a changé »** : Blink a modifié sa connexion ; une mise à jour de l’intégration
  est nécessaire (ouvrez un ticket).
- **Pas d’événement de mouvement** : le système doit être armé et la détection de la caméra activée ; l’événement
  arrive à la lecture suivante.
- **Journaux détaillés** : réglez `LOG_LEVEL=debug` sur l’intégration. Les journaux ne montrent jamais le mot de
  passe, les jetons ni les codes.

## Limites

- Cloud uniquement : sans Internet, rien ne marche ; Blink n’a pas d’API locale.
- Pas de vidéo en direct ni de téléchargement de clips : seulement les miniatures.
- Pas de push de Blink vers les tiers : le mouvement et la sonnette sont vus à la lecture suivante.
- Un appui sur la sonnette est reconnu par le clip que Blink enregistre ; si la sonnette n’enregistre rien à
  l’appui (réglage de l’application Blink), il n’est pas vu.
- Blink ne publie pas son API : un changement de leur côté peut casser l’intégration jusqu’à sa mise à jour.

## Confidentialité et données

L’intégration garde dans `/data` (lisible par son seul propriétaire) l’identifiant de ce client auprès de Blink et
les jetons de session, jamais le mot de passe ni l’adresse e-mail. Les images restent entre Blink, l’intégration et
votre Gladys.

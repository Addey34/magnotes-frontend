/**
 * Translation dictionary. Each key maps to a `{ fr, en }` pair. Add keys in
 * dotted namespaces (`surface.element`) and keep both languages in sync — the
 * i18n.test.ts parity test fails if a pair is missing a language.
 *
 * Conversion is incremental by surface; `auth.*` (the login flow) and `app.*`
 * (the board chrome) are done. Deeper view components are converted next.
 */

export interface TranslationEntry {
    fr: string;
    en: string;
}

export const DICTIONARY = {
    // --- auth screen ---------------------------------------------------------
    'auth.brand.tagline': { fr: 'Workspace', en: 'Workspace' },
    'auth.eyebrow': { fr: 'Votre espace visuel', en: 'Your visual space' },
    'auth.hero.title1': {
        fr: 'Organisez vos idées,',
        en: 'Organize your ideas,',
    },
    'auth.hero.title2': { fr: ' naturellement.', en: ' naturally.' },
    'auth.hero.sub': {
        fr: 'Un tableau libre pour capturer, rapprocher et structurer ce qui compte.',
        en: 'A free-form board to capture, connect and structure what matters.',
    },
    'auth.visual.aria': { fr: 'Aperçu de MagNotes', en: 'MagNotes preview' },
    'auth.panel.aria': { fr: 'Authentification', en: 'Authentication' },

    'auth.kicker.login': { fr: 'Connexion', en: 'Sign in' },
    'auth.kicker.register': { fr: 'Inscription', en: 'Sign up' },
    'auth.kicker.verify': { fr: 'Vérification', en: 'Verification' },
    'auth.kicker.forgot': { fr: 'Mot de passe oublié', en: 'Forgot password' },
    'auth.kicker.reset': { fr: 'Nouveau mot de passe', en: 'New password' },
    'auth.title.login': { fr: 'Ravi de vous revoir', en: 'Welcome back' },
    'auth.title.register': {
        fr: 'Créez votre espace',
        en: 'Create your space',
    },
    'auth.title.verify': {
        fr: 'Confirmez votre e-mail',
        en: 'Confirm your email',
    },
    'auth.title.forgot': {
        fr: 'Réinitialiser l’accès',
        en: 'Reset your access',
    },
    'auth.title.reset': {
        fr: 'Choisissez un mot de passe',
        en: 'Choose a password',
    },
    'auth.sub.login': {
        fr: 'Retrouvez vos tableaux et reprenez là où vous en étiez.',
        en: 'Find your boards and pick up where you left off.',
    },
    'auth.sub.register': {
        fr: 'Un e-mail, un mot de passe, et c’est parti.',
        en: 'An email, a password, and you’re set.',
    },
    'auth.sub.verify': {
        fr: 'Entrez le code à 6 chiffres envoyé à {email}.',
        en: 'Enter the 6-digit code sent to {email}.',
    },
    'auth.sub.forgot': {
        fr: 'Indiquez votre e-mail pour recevoir un code de réinitialisation.',
        en: 'Enter your email to receive a reset code.',
    },
    'auth.sub.reset': {
        fr: 'Saisissez le code reçu par e-mail et votre nouveau mot de passe.',
        en: 'Enter the emailed code and your new password.',
    },

    'auth.field.email': { fr: 'Adresse e-mail', en: 'Email address' },
    'auth.field.code': { fr: 'Code de vérification', en: 'Verification code' },
    'auth.field.password': { fr: 'Mot de passe', en: 'Password' },
    'auth.field.newPassword': {
        fr: 'Nouveau mot de passe',
        en: 'New password',
    },
    'auth.field.confirm': {
        fr: 'Confirmer le mot de passe',
        en: 'Confirm password',
    },
    'auth.placeholder.email': { fr: 'vous@exemple.com', en: 'you@example.com' },
    'auth.placeholder.password': {
        fr: 'Votre mot de passe',
        en: 'Your password',
    },
    'auth.placeholder.confirm': {
        fr: 'Confirmez votre mot de passe',
        en: 'Confirm your password',
    },
    'auth.password.show': {
        fr: 'Afficher le mot de passe',
        en: 'Show password',
    },
    'auth.password.hide': {
        fr: 'Masquer le mot de passe',
        en: 'Hide password',
    },
    'auth.forgotLink': { fr: 'Mot de passe oublié ?', en: 'Forgot password?' },

    'auth.submit.login': { fr: 'Se connecter', en: 'Sign in' },
    'auth.submit.register': {
        fr: 'Créer mon compte',
        en: 'Create my account',
    },
    'auth.submit.verify': { fr: 'Confirmer', en: 'Confirm' },
    'auth.submit.forgot': { fr: 'Envoyer le code', en: 'Send the code' },
    'auth.submit.reset': { fr: 'Réinitialiser', en: 'Reset' },
    'auth.submit.loading': { fr: 'Chargement...', en: 'Loading...' },

    'auth.verify.noCode': {
        fr: 'Vous n’avez rien reçu ?',
        en: 'Didn’t get anything?',
    },
    'auth.verify.resend': { fr: 'Renvoyer le code', en: 'Resend the code' },
    'auth.backToLogin': { fr: 'Retour à la connexion', en: 'Back to sign in' },
    'auth.switch.toRegister': {
        fr: 'Vous découvrez MagNotes ?',
        en: 'New to MagNotes?',
    },
    'auth.switch.toLogin': {
        fr: 'Vous avez déjà un compte ?',
        en: 'Already have an account?',
    },
    'auth.switch.register': { fr: 'Créer un compte', en: 'Create an account' },
    'auth.switch.login': { fr: 'Se connecter', en: 'Sign in' },

    'auth.notice.codeSent': {
        fr: 'Code envoyé. Vérifiez votre boîte mail.',
        en: 'Code sent. Check your inbox.',
    },
    'auth.notice.verifyFirst': {
        fr: 'Confirmez d’abord votre e-mail avec le code reçu.',
        en: 'Confirm your email first with the code we sent.',
    },
    'auth.notice.resetCodeSent': {
        fr: 'Si un compte existe, un code de réinitialisation a été envoyé.',
        en: 'If an account exists, a reset code has been sent.',
    },
    'auth.notice.passwordReset': {
        fr: 'Mot de passe réinitialisé. Vous pouvez vous connecter.',
        en: 'Password reset. You can now sign in.',
    },
    'auth.error.emailRequired': {
        fr: 'L’adresse e-mail est requise.',
        en: 'Email address is required.',
    },
    'auth.error.emailInvalid': {
        fr: 'L’adresse e-mail n’est pas valide.',
        en: 'Enter a valid email address.',
    },
    'auth.error.emailTooLong': {
        fr: 'L’adresse e-mail est trop longue.',
        en: 'The email address is too long.',
    },
    'auth.error.passwordRequired': {
        fr: 'Le mot de passe est requis.',
        en: 'Password is required.',
    },
    'auth.error.passwordMismatch': {
        fr: 'Les mots de passe ne correspondent pas.',
        en: 'The passwords do not match.',
    },
    'auth.error.passwordLength': {
        fr: 'Le mot de passe doit contenir au moins 8 caractères.',
        en: 'The password must be at least 8 characters.',
    },
    'auth.error.passwordTooLong': {
        fr: 'Le mot de passe ne peut pas dépasser 128 caractères.',
        en: 'The password cannot exceed 128 characters.',
    },
    'auth.error.codeInvalid': {
        fr: 'Code invalide ou expiré.',
        en: 'The code is invalid or expired.',
    },
    'auth.error.invalidCredentials': {
        fr: 'E-mail ou mot de passe incorrect.',
        en: 'Incorrect email address or password.',
    },
    'auth.error.accountExists': {
        fr: 'Un compte existe déjà avec cet e-mail.',
        en: 'An account already exists with this email address.',
    },
    'auth.error.accountVerified': {
        fr: 'Ce compte est déjà vérifié, connectez-vous.',
        en: 'This account is already verified. Sign in instead.',
    },
    'auth.error.resendTooSoon': {
        fr: 'Un code a déjà été envoyé récemment. Patientez un instant.',
        en: 'A code was sent recently. Please wait before trying again.',
    },
    'auth.error.tooManyAttempts': {
        fr: 'Trop de tentatives. Demandez un nouveau code.',
        en: 'Too many attempts. Request a new code.',
    },
    'auth.error.server': {
        fr: 'Impossible de contacter le serveur.',
        en: 'Could not reach the server.',
    },
    'auth.error.resend': {
        fr: 'Impossible de renvoyer le code.',
        en: 'Could not resend the code.',
    },

    'auth.demo.1.title': { fr: 'Sprint planning', en: 'Sprint planning' },
    'auth.demo.1.content': {
        fr: 'Définir les priorités du Q3',
        en: 'Set the Q3 priorities',
    },
    'auth.demo.2.title': { fr: 'Bug critique', en: 'Critical bug' },
    'auth.demo.2.content': {
        fr: 'Revoir le refresh token',
        en: 'Review the refresh token',
    },
    'auth.demo.3.title': { fr: 'Idée produit', en: 'Product idea' },
    'auth.demo.3.content': {
        fr: 'Collaboration en temps réel',
        en: 'Real-time collaboration',
    },
    'auth.demo.4.title': { fr: 'Design system', en: 'Design system' },
    'auth.demo.4.content': {
        fr: 'Finaliser les couleurs v2',
        en: 'Finalize the v2 colors',
    },
    'auth.demo.5.title': { fr: 'Réunion lundi', en: 'Monday meeting' },
    'auth.demo.5.content': {
        fr: '10h · revue des objectifs',
        en: '10am · goals review',
    },

    // --- board shell chrome --------------------------------------------------
    'app.brand.menuTitle': { fr: 'Menu MagNotes', en: 'MagNotes menu' },
    'app.brand.subtitle': {
        fr: 'Workspace personnel',
        en: 'Personal workspace',
    },
    'app.brand.about': {
        fr: 'Tableaux personnels de notes',
        en: 'Personal note boards',
    },
    'app.menu.preferences': { fr: 'Préférences', en: 'Preferences' },
    'app.menu.language': { fr: 'Langue', en: 'Language' },
    'app.menu.preferences.sub': {
        fr: "Rappels d'échéance",
        en: 'Due-date reminders',
    },
    'app.preferences.title': {
        fr: "Rappels d'échéance",
        en: 'Due-date reminders',
    },
    'app.preferences.description': {
        fr: 'Recevez uniquement les rappels que vous activez. Les cartes terminées sont toujours exclues.',
        en: 'Receive only the reminders you enable. Completed cards are always excluded.',
    },
    'app.preferences.frequency': { fr: 'Fréquence', en: 'Frequency' },
    'app.preferences.off': { fr: 'Désactivés', en: 'Disabled' },
    'app.preferences.daily': { fr: 'Chaque jour', en: 'Daily' },
    'app.preferences.weekly': {
        fr: 'Chaque lundi',
        en: 'Every Monday',
    },
    'app.preferences.timezone': { fr: 'Fuseau horaire', en: 'Time zone' },
    'app.preferences.hour': { fr: "Heure d'envoi", en: 'Delivery time' },
    'app.preferences.loading': {
        fr: 'Chargement des préférences…',
        en: 'Loading preferences…',
    },
    'app.preferences.loadError': {
        fr: 'Impossible de charger les préférences.',
        en: 'Unable to load preferences.',
    },
    'app.preferences.saveError': {
        fr: "Impossible d'enregistrer les préférences.",
        en: 'Unable to save preferences.',
    },
    'app.preferences.saved': {
        fr: 'Préférences enregistrées.',
        en: 'Preferences saved.',
    },
    'app.preferences.close': { fr: 'Fermer', en: 'Close' },
    'app.preferences.save': { fr: 'Enregistrer', en: 'Save' },
    'app.preferences.saving': {
        fr: 'Enregistrement…',
        en: 'Saving…',
    },
    'app.menu.exportMd': {
        fr: 'Exporter en Markdown',
        en: 'Export as Markdown',
    },
    'app.menu.exportMd.sub': {
        fr: 'Le tableau courant en .md',
        en: 'The current board as .md',
    },
    'app.menu.import': {
        fr: 'Importer (Markdown / Notion / Trello)',
        en: 'Import (Markdown / Notion / Trello)',
    },
    'app.menu.import.sub': {
        fr: 'Depuis un .md, un CSV Notion ou un export Trello .json',
        en: 'From .md, Notion CSV, or a Trello .json export',
    },
    'app.menu.exportData': {
        fr: 'Exporter mes données',
        en: 'Export my data',
    },
    'app.menu.exportData.loading': {
        fr: 'Export en cours…',
        en: 'Exporting…',
    },
    'app.menu.exportData.sub': {
        fr: 'Télécharger un fichier JSON',
        en: 'Download a JSON file',
    },
    'app.menu.share': { fr: 'Partager ce tableau', en: 'Share this board' },
    'app.menu.share.active': {
        fr: 'Lien public actif',
        en: 'Public link active',
    },
    'app.menu.share.inactive': {
        fr: 'Lien public en lecture seule',
        en: 'Read-only public link',
    },
    'app.menu.feedback': { fr: 'Envoyer un avis', en: 'Send feedback' },
    'app.menu.feedback.sub': {
        fr: 'Une remarque, une idée, un bug',
        en: 'A remark, an idea, a bug',
    },
    'app.menu.deleteAccount': {
        fr: 'Supprimer mon compte',
        en: 'Delete my account',
    },
    'app.menu.deleteAccount.sub': {
        fr: 'Efface toutes vos données',
        en: 'Erases all your data',
    },
    'app.menu.createAccount': {
        fr: 'Créer un compte',
        en: 'Create an account',
    },
    'app.menu.createAccount.sub': {
        fr: 'Garder mes notes en ligne',
        en: 'Keep my notes online',
    },
    'app.theme.light': { fr: 'Thème clair', en: 'Light theme' },
    'app.theme.dark': { fr: 'Thème sombre', en: 'Dark theme' },
    'app.logout': { fr: 'Déconnexion', en: 'Sign out' },
    'app.sidebar.collapse': {
        fr: 'Réduire la barre latérale',
        en: 'Collapse sidebar',
    },
    'app.sidebar.collapse.sub': {
        fr: 'Garder plus de place pour le tableau',
        en: 'Give the board more room',
    },

    // --- guest demo banner ---------------------------------------------------
    'app.demo.title': { fr: 'Mode démo.', en: 'Demo mode.' },
    'app.demo.text': {
        fr: 'Vos notes restent sur cet appareil.',
        en: 'Your notes stay on this device.',
    },
    'app.demo.cta': {
        fr: 'Créer un compte pour les garder →',
        en: 'Create an account to keep them →',
    },

    // --- share dialog --------------------------------------------------------
    'share.title': { fr: 'Partager « {name} »', en: 'Share “{name}”' },
    'share.close': { fr: 'Fermer', en: 'Close' },
    'share.aria': { fr: 'Partager le tableau', en: 'Share the board' },
    'share.hint.active': {
        fr: 'Toute personne disposant de ce lien peut consulter ce tableau en lecture seule (sans compte).',
        en: 'Anyone with this link can view this board read-only (no account needed).',
    },
    'share.hint.inactive': {
        fr: 'Génère un lien public en lecture seule pour ce tableau. Vous pourrez le désactiver à tout moment.',
        en: 'Generate a read-only public link for this board. You can disable it at any time.',
    },
    'share.linkAria': { fr: 'Lien de partage', en: 'Share link' },
    'share.copy': { fr: 'Copier', en: 'Copy' },
    'share.copied': { fr: 'Copié ✓', en: 'Copied ✓' },
    'share.revoke': { fr: 'Désactiver le partage', en: 'Disable sharing' },
    'share.enable': { fr: 'Activer le partage', en: 'Enable sharing' },
    'share.enabling': { fr: 'Activation…', en: 'Enabling…' },

    // --- feedback dialog -------------------------------------------------------
    'feedback.title': { fr: 'Envoyer un avis', en: 'Send feedback' },
    'feedback.close': { fr: 'Fermer', en: 'Close' },
    'feedback.aria': {
        fr: "Envoyer un avis à l'équipe",
        en: 'Send feedback to the team',
    },
    'feedback.hint': {
        fr: 'Une remarque, une idée, un bug ? Écrivez-nous, on lit tout.',
        en: 'A remark, an idea, a bug? Write to us, we read everything.',
    },
    'feedback.placeholder': {
        fr: 'Votre message…',
        en: 'Your message…',
    },
    'feedback.textareaAria': { fr: 'Votre message', en: 'Your message' },
    'feedback.send': { fr: 'Envoyer', en: 'Send' },
    'feedback.sending': { fr: 'Envoi…', en: 'Sending…' },
    'feedback.thanks': {
        fr: 'Merci ! Votre message a bien été envoyé.',
        en: 'Thanks! Your message has been sent.',
    },
    'feedback.error': {
        fr: "Échec de l'envoi. Réessayez dans un instant.",
        en: 'Failed to send. Please try again in a moment.',
    },

    // --- command palette commands & groups ----------------------------------
    'app.cmd.newCard': { fr: 'Nouveau post-it', en: 'New sticky note' },
    'app.cmd.frame': { fr: 'Cadrer tout le contenu', en: 'Fit all content' },
    'app.cmd.undo': { fr: 'Annuler', en: 'Undo' },
    'app.cmd.redo': { fr: 'Rétablir', en: 'Redo' },
    'app.cmd.exportMd': {
        fr: 'Exporter le tableau en Markdown',
        en: 'Export board as Markdown',
    },
    'app.cmd.import': {
        fr: 'Importer un fichier (Markdown, Notion ou Trello)',
        en: 'Import a file (Markdown, Notion or Trello)',
    },
    'app.cmd.share': {
        fr: 'Partager le tableau (lien public)',
        en: 'Share the board (public link)',
    },
    'app.cmd.exportData': { fr: 'Exporter mes données', en: 'Export my data' },
    'app.cmd.viewCanvas': { fr: 'Vue Canvas', en: 'Canvas view' },
    'app.cmd.viewKanban': { fr: 'Vue Kanban', en: 'Kanban view' },
    'app.cmd.viewAgenda': { fr: 'Vue Agenda', en: 'Agenda view' },
    'app.cmd.viewTimeline': { fr: 'Vue Planning', en: 'Planning view' },
    'app.cmd.hint.insert': { fr: 'Insérer', en: 'Insert' },
    'app.cmd.template': { fr: 'Modèle : {label}', en: 'Template: {label}' },
    // Command descriptions (one-line subtitles in the palette).
    'app.cmd.newCard.desc': {
        fr: 'Ajoute une note vide au centre de la vue',
        en: 'Adds an empty note at the center of the view',
    },
    'app.cmd.frame.desc': {
        fr: 'Zoome pour voir toutes les cartes',
        en: 'Zoom to fit all cards',
    },
    'app.cmd.undo.desc': { fr: 'Revenir en arrière', en: 'Step backward' },
    'app.cmd.redo.desc': {
        fr: 'Refaire l’action annulée',
        en: 'Redo the undone action',
    },
    'app.cmd.theme.desc': {
        fr: 'Basculer entre clair et sombre',
        en: 'Toggle light / dark',
    },
    'app.cmd.exportMd.desc': {
        fr: 'Télécharge le tableau en fichier .md',
        en: 'Download the board as a .md file',
    },
    'app.cmd.import.desc': {
        fr: 'Ajoute des cartes depuis un .md, un CSV Notion ou Trello',
        en: 'Add cards from .md, Notion CSV, or Trello',
    },
    'app.cmd.share.desc': {
        fr: 'Crée un lien public en lecture seule',
        en: 'Create a read-only public link',
    },
    'app.cmd.exportData.desc': {
        fr: 'Sauvegarde toutes tes données en JSON',
        en: 'Back up all your data as JSON',
    },
    'app.cmd.viewCanvas.desc': {
        fr: 'Le tableau libre infini',
        en: 'The infinite free canvas',
    },
    'app.cmd.viewKanban.desc': {
        fr: 'Cartes en colonnes par statut',
        en: 'Cards in columns by status',
    },
    'app.cmd.viewAgenda.desc': {
        fr: 'Cartes groupées par échéance',
        en: 'Cards grouped by due date',
    },
    'app.cmd.viewTimeline.desc': {
        fr: 'Cartes sur une frise temporelle',
        en: 'Cards on a timeline',
    },
    'app.cmd.template.desc': {
        fr: 'Insère un tableau prêt à l’emploi',
        en: 'Insert a ready-made board',
    },
    'app.untitled': { fr: 'Sans titre', en: 'Untitled' },
    'app.group.actions': { fr: 'Actions', en: 'Actions' },
    'app.group.account': { fr: 'Compte', en: 'Account' },
    'app.group.views': { fr: 'Vues', en: 'Views' },
    'app.group.templates': { fr: 'Modèles', en: 'Templates' },
    'app.group.goto': { fr: 'Aller à', en: 'Go to' },

    // --- board topbar --------------------------------------------------------
    'app.rename.aria': {
        fr: 'Renommer la page active',
        en: 'Rename the active page',
    },
    'app.rename.save': { fr: 'Enregistrer le nom', en: 'Save the name' },
    'app.rename.title': { fr: 'Renommer cette page', en: 'Rename this page' },
    'app.view.canvas': { fr: 'Canvas', en: 'Canvas' },
    'app.view.switcher': { fr: 'Changer de vue', en: 'Change view' },
    'app.view.canvas.title': { fr: 'Vue canvas', en: 'Canvas view' },
    'app.view.kanban': { fr: 'Kanban', en: 'Kanban' },
    'app.view.kanban.title': { fr: 'Vue Kanban', en: 'Kanban view' },
    'app.view.agenda': { fr: 'Agenda', en: 'Agenda' },
    'app.view.agenda.title': { fr: 'Vue agenda', en: 'Agenda view' },
    'app.view.timeline': { fr: 'Planning', en: 'Planning' },
    'app.view.timeline.title': { fr: 'Vue planning', en: 'Planning view' },
    'app.search.placeholder': {
        fr: 'Rechercher une note',
        en: 'Search a note',
    },
    'app.search.clear': { fr: 'Effacer', en: 'Clear' },
    'app.filter.color': { fr: 'Filtrer par couleur', en: 'Filter by color' },
    'app.filter.allColors': { fr: 'Toutes les couleurs', en: 'All colors' },
    'app.filter.colorDot': {
        fr: 'Filtrer la couleur {color}',
        en: 'Filter color {color}',
    },
    'app.status.results': { fr: '{n} résultat(s)', en: '{n} result(s)' },
    'app.status.free': { fr: 'Canvas libre', en: 'Free canvas' },
    'app.sync.offline': { fr: 'Hors ligne', en: 'Offline' },
    'app.sync.local': {
        fr: 'Stocké sur cet appareil',
        en: 'Stored on this device',
    },
    'app.sync.saving': { fr: 'Enregistrement…', en: 'Saving…' },
    'app.sync.saved': { fr: 'Synchronisé', en: 'Synced' },
    'app.sync.error': { fr: 'À vérifier', en: 'Needs attention' },
    'app.selection.count': {
        fr: '{n} sélectionnée(s)',
        en: '{n} selected',
    },
    'app.selection.duplicate': { fr: 'Dupliquer', en: 'Duplicate' },
    'app.selection.delete': { fr: 'Supprimer', en: 'Delete' },
    'app.selection.clear': { fr: 'Désélectionner', en: 'Clear selection' },
    'app.help.linking': {
        fr: 'Cliquez une carte cible pour créer le lien · Échap pour annuler',
        en: 'Click a target card to create the link · Esc to cancel',
    },
    'app.help.canvas': {
        fr: 'Double-cliquez le fond pour créer · Cliquez une note pour éditer · Maintenez la poignée pour déplacer · Molette pour zoomer',
        en: 'Double-click the background to create · Click a note to edit · Hold the handle to move · Scroll to zoom',
    },
    'app.help.title': { fr: 'Aide et raccourcis', en: 'Help and shortcuts' },
    'app.help.shortcuts': {
        fr: 'N créer · Suppr supprimer · Ctrl+D dupliquer · Ctrl+Z annuler · Ctrl+K palette',
        en: 'N create · Delete remove · Ctrl+D duplicate · Ctrl+Z undo · Ctrl+K palette',
    },
    'app.zoom.aria': { fr: 'Zoom du tableau', en: 'Board zoom' },
    'app.zoom.out': { fr: 'Dézoomer', en: 'Zoom out' },
    'app.zoom.in': { fr: 'Zoomer', en: 'Zoom in' },
    'app.zoom.fit': { fr: 'Cadrer toutes les notes', en: 'Fit all notes' },
    'app.appearance': { fr: 'Apparence', en: 'Appearance' },
    'app.appearance.title': {
        fr: 'Apparence du tableau',
        en: 'Board appearance',
    },
    'app.history.aria': { fr: 'Historique', en: 'History' },
    'app.history.undo': { fr: 'Annuler (Ctrl+Z)', en: 'Undo (Ctrl+Z)' },
    'app.history.redo': {
        fr: 'Rétablir (Ctrl+Maj+Z)',
        en: 'Redo (Ctrl+Shift+Z)',
    },
    'app.palette.title': {
        fr: 'Palette de commandes (Ctrl+K)',
        en: 'Command palette (Ctrl+K)',
    },
    'app.newCard.short': { fr: 'Post-it', en: 'Sticky note' },
    'app.mobileActions.aria': {
        fr: 'Actions rapides du tableau',
        en: 'Board quick actions',
    },
    'app.mobileActions.palette': { fr: 'Rechercher', en: 'Search' },
    'app.mobileActions.fit': { fr: 'Cadrer', en: 'Fit' },
    'app.newCard.title': {
        fr: 'Nouveau post-it (ou double-clic sur le tableau)',
        en: 'New sticky note — or double-click the board',
    },
    'app.board.default': { fr: 'Tableau', en: 'Board' },
    'app.unit.note': { fr: 'note', en: 'note' },
    'app.unit.stack': { fr: 'pile', en: 'stack' },
    'app.plural': { fr: 's', en: 's' },

    // --- board states --------------------------------------------------------
    'app.loading': { fr: 'Chargement du tableau', en: 'Loading the board' },
    'app.minimap.aria': { fr: 'Aperçu du tableau', en: 'Board overview' },
    'app.empty.title': {
        fr: 'Votre tableau est vide',
        en: 'Your board is empty',
    },
    'app.empty.text': {
        fr: 'Double-cliquez dans le canvas ou créez votre première note.',
        en: 'Double-click the canvas or create your first note.',
    },
    'app.empty.create': { fr: 'Créer un post-it', en: 'Create a sticky note' },
    'app.empty.template': {
        fr: 'Découvrir avec un exemple',
        en: 'Explore with an example',
    },
    'app.empty.templateTitle': {
        fr: 'Charger le tableau de bienvenue',
        en: 'Load the welcome board',
    },
    'app.empty.noResults': { fr: 'Aucune note trouvée', en: 'No note found' },
    'app.empty.tipsAria': {
        fr: 'Conseils pour commencer',
        en: 'Getting started tips',
    },
    'app.empty.tip.create': {
        fr: 'Double-cliquez pour créer une note',
        en: 'Double-click to create a note',
    },
    'app.empty.tip.palette': {
        fr: 'Ouvrez la palette avec Ctrl/Cmd+K',
        en: 'Open the palette with Ctrl/Cmd+K',
    },
    'app.empty.resetFilters': {
        fr: 'Réinitialiser les filtres',
        en: 'Reset filters',
    },

    // --- delete account dialog ----------------------------------------------
    'app.delete.aria': { fr: 'Supprimer mon compte', en: 'Delete my account' },
    'app.delete.title': {
        fr: 'Supprimer votre compte ?',
        en: 'Delete your account?',
    },
    'app.delete.body': {
        fr: 'Cette action est définitive. Tous vos tableaux, notes et piles seront supprimés sans possibilité de récupération.',
        en: 'This action is permanent. All your boards, notes and stacks will be deleted with no way to recover them.',
    },
    'app.delete.placeholder': {
        fr: 'Confirmez avec votre mot de passe',
        en: 'Confirm with your password',
    },
    'app.delete.cancel': { fr: 'Annuler', en: 'Cancel' },
    'app.delete.confirm': {
        fr: 'Supprimer définitivement',
        en: 'Delete permanently',
    },
    'app.delete.deleting': { fr: 'Suppression…', en: 'Deleting…' },
    'app.delete.needPassword': {
        fr: 'Saisissez votre mot de passe pour confirmer.',
        en: 'Enter your password to confirm.',
    },
    'app.delete.failed': {
        fr: 'Suppression impossible.',
        en: 'Deletion failed.',
    },

    // --- command palette (internal UI) --------------------------------------
    'palette.quickCapture': {
        fr: 'Créer la note « {query} »',
        en: 'Create the note “{query}”',
    },
    'palette.group.capture': { fr: 'Capture', en: 'Capture' },
    'palette.aria': { fr: 'Palette de commandes', en: 'Command palette' },
    'palette.placeholder': {
        fr: 'Rechercher une commande, créer une note…',
        en: 'Search a command, create a note…',
    },
    'palette.searchAria': {
        fr: 'Rechercher une commande',
        en: 'Search a command',
    },
    'palette.esc': { fr: 'Échap', en: 'Esc' },
    'palette.empty': {
        fr: 'Aucune commande ne correspond.',
        en: 'No matching command.',
    },

    // --- card status (shared by public view, Kanban, Agenda) ----------------
    'status.todo': { fr: 'À faire', en: 'To do' },
    'status.doing': { fr: 'En cours', en: 'In progress' },
    'status.done': { fr: 'Fait', en: 'Done' },
    'status.none': { fr: 'Sans statut', en: 'No status' },
    'priority.low': { fr: 'Basse', en: 'Low' },
    'priority.medium': { fr: 'Moyenne', en: 'Medium' },
    'priority.high': { fr: 'Haute', en: 'High' },

    // --- alternate views (Kanban / Agenda / Timeline) -----------------------
    'view.agenda.none': { fr: 'Sans échéance', en: 'No due date' },
    'view.agenda.overdue': { fr: 'En retard', en: 'Overdue' },
    'view.agenda.today': { fr: "Aujourd'hui", en: 'Today' },
    'view.agenda.week': { fr: 'Cette semaine', en: 'This week' },
    'view.agenda.later': { fr: 'Plus tard', en: 'Later' },
    'view.agenda.empty': {
        fr: 'Aucune note à afficher dans l’agenda.',
        en: 'No note to show in the agenda.',
    },
    'view.agenda.statusAria': { fr: 'Statut', en: 'Status' },
    'view.timeline.empty': {
        fr: 'Aucune note à planifier pour l’instant.',
        en: 'No note to schedule yet.',
    },
    'view.timeline.overdue': { fr: 'En retard', en: 'Overdue' },
    'view.timeline.noDue': { fr: 'Sans échéance', en: 'No due date' },

    // --- public shared board view --------------------------------------------
    'public.loading': {
        fr: 'Chargement du tableau…',
        en: 'Loading the board…',
    },
    'public.notfound.title': {
        fr: 'Ce tableau n’est pas disponible',
        en: 'This board is not available',
    },
    'public.notfound.text': {
        fr: 'Le lien de partage est invalide ou a été désactivé par son propriétaire.',
        en: 'The share link is invalid or was disabled by its owner.',
    },
    'public.createMine': { fr: 'Créer mon tableau', en: 'Create my board' },
    'public.madeWith.pre': { fr: 'Créé avec', en: 'Made with' },
    'public.madeWith.post': {
        fr: ', créer le mien →',
        en: '— make mine →',
    },

    // --- appearance panel & board themes ------------------------------------
    'appearance.ambiance': { fr: 'Ambiance du tableau', en: 'Board ambiance' },
    'appearance.background': {
        fr: 'Fond du tableau',
        en: 'Board background',
    },
    'appearance.customSwatch': {
        fr: 'Couleur de fond personnalisée',
        en: 'Custom background color',
    },
    'appearance.customActive': {
        fr: 'Couleur personnalisée active',
        en: 'Custom color active',
    },
    'appearance.followsTheme': {
        fr: 'Suit l’ambiance choisie',
        en: 'Follows the chosen ambiance',
    },
    'appearance.reset': {
        fr: 'Rétablir le fond de l’ambiance',
        en: 'Reset to ambiance background',
    },
    'theme.clair.label': { fr: 'Épuré', en: 'Clean' },
    'theme.clair.desc': {
        fr: 'Suit le thème clair ou sombre de l’application.',
        en: 'Follows the app’s light or dark theme.',
    },
    'theme.frigo.label': { fr: 'Frigo', en: 'Fridge' },
    'theme.frigo.desc': {
        fr: 'Inox brossé et blanc laqué, ambiance porte de frigo.',
        en: 'Brushed steel and lacquered white — a fridge-door vibe.',
    },
    'theme.magnetique.label': { fr: 'Magnétique', en: 'Magnetic' },
    'theme.magnetique.desc': {
        fr: 'Tableau d’atelier sombre à pastille aimantée.',
        en: 'Dark workshop board with a magnetic dot.',
    },
    'theme.liege.label': { fr: 'Liège', en: 'Cork' },
    'theme.liege.desc': {
        fr: 'Panneau de liège chaleureux et cadre bois.',
        en: 'Warm cork board with a wooden frame.',
    },
    'theme.ardoise.label': { fr: 'Ardoise', en: 'Slate' },
    'theme.ardoise.desc': {
        fr: 'Tableau noir à la craie, contrastes doux.',
        en: 'Chalk blackboard with soft contrasts.',
    },

    // --- board tabs (sidebar) -----------------------------------------------
    'tabs.aria': { fr: 'Tableaux', en: 'Boards' },
    'tabs.reorder': { fr: 'Reordonner', en: 'Reorder' },
    'tabs.rename': { fr: 'Renommer {name}', en: 'Rename {name}' },
    'tabs.customize': { fr: 'Personnaliser {name}', en: 'Customize {name}' },
    'tabs.colorLabel': { fr: 'Couleur', en: 'Color' },
    'tabs.customColorFor': {
        fr: 'Choisir une couleur personnalisée pour {name}',
        en: 'Pick a custom color for {name}',
    },
    'tabs.iconLabel': { fr: 'Icône', en: 'Icon' },
    'tabs.pickIcon': {
        fr: 'Choisir {emoji} comme icône',
        en: 'Pick {emoji} as the icon',
    },
    'tabs.deleteConfirm': {
        fr: 'Supprimer « {name} » et toutes ses notes ?',
        en: 'Delete “{name}” and all its notes?',
    },
    'tabs.newBoard': { fr: 'Nouveau tableau', en: 'New board' },
    'stack.previewAria': {
        fr: 'Aperçu des notes de la pile',
        en: 'Preview of the stack’s notes',
    },
    'stack.show': { fr: 'Afficher la pile', en: 'Show the stack' },
    'stack.collapse': { fr: 'Replier la pile', en: 'Collapse the stack' },
    'stack.promote': {
        fr: 'Mettre « {title} » au sommet',
        en: 'Bring “{title}” to the top',
    },
    'stack.emptyPreview': { fr: 'Pile de notes', en: 'Note stack' },
    'stack.emptyCard': { fr: 'Note vide', en: 'Empty note' },

    // --- common --------------------------------------------------------------
    'common.close': { fr: 'Fermer', en: 'Close' },

    // --- card detail modal ---------------------------------------------------
    'card.detail.aria': {
        fr: 'Édition détaillée de la carte',
        en: 'Detailed card editing',
    },
    'card.title.placeholder': { fr: 'Titre', en: 'Title' },
    'card.detail.markdown': { fr: 'Markdown', en: 'Markdown' },
    'card.detail.contentPlaceholder': {
        fr: 'Écris ici… **gras**, *italique*, - listes, [lien](https://…)',
        en: 'Write here… **bold**, *italic*, - lists, [link](https://…)',
    },
    'card.detail.contentAria': {
        fr: 'Contenu Markdown',
        en: 'Markdown content',
    },
    'card.detail.preview': { fr: 'Aperçu', en: 'Preview' },
    'card.detail.previewEmpty': {
        fr: 'L’aperçu s’affiche ici.',
        en: 'The preview appears here.',
    },

    // --- post-it card (inline editing) --------------------------------------
    'card.saving': { fr: 'Sauvegarde', en: 'Saving' },
    'card.saved': { fr: 'Enregistré', en: 'Saved' },
    'card.error': { fr: 'Erreur', en: 'Error' },
    'card.media.badFormat': {
        fr: 'Format non supporté (png, jpg, gif, webp).',
        en: 'Unsupported format (png, jpg, gif, webp).',
    },
    'card.media.tooLarge': {
        fr: 'Image trop lourde (max 1 Mo).',
        en: 'Image too large (max 1 MB).',
    },
    'card.media.readError': {
        fr: 'Lecture de l’image impossible.',
        en: 'Could not read the image.',
    },
    'card.media.badUrl': {
        fr: 'Entrez une URL http(s) valide.',
        en: 'Enter a valid http(s) URL.',
    },
    'card.media.notFound': {
        fr: 'Image introuvable.',
        en: 'Image not found.',
    },
    'card.tool.color': { fr: 'Couleur de carte', en: 'Card color' },
    'card.tool.move': { fr: 'Maintenir pour déplacer', en: 'Hold to move' },
    'card.tool.rotate': { fr: 'Faire pivoter la note', en: 'Rotate note' },
    'card.tool.text': { fr: 'Texte', en: 'Text' },
    'card.tool.task': {
        fr: 'Tâche (statut, échéance, checklist)',
        en: 'Task (status, due date, checklist)',
    },
    'card.tool.link': {
        fr: 'Relier à une autre carte',
        en: 'Link to another card',
    },
    'card.tool.image': {
        fr: 'Image (URL, coller ou déposer)',
        en: 'Image (URL, paste or drop)',
    },
    'card.tool.expand': {
        fr: 'Agrandir (édition Markdown)',
        en: 'Expand (Markdown editing)',
    },
    'card.tool.duplicate': { fr: 'Dupliquer', en: 'Duplicate' },
    'card.tool.delete': { fr: 'Supprimer', en: 'Delete' },
    'card.image.urlAria': { fr: 'URL de l’image', en: 'Image URL' },
    'card.color.custom': { fr: 'Couleur personnalisée', en: 'Custom color' },
    'card.styles': { fr: 'Styles', en: 'Styles' },
    'card.font.aria': { fr: 'Police du texte', en: 'Text font' },
    'card.unstack': { fr: 'Sortir de la pile', en: 'Remove from stack' },
    'card.moveToPage': { fr: 'Déplacer vers une page', en: 'Move to a page' },
    'card.section.status': { fr: 'Statut', en: 'Status' },
    'card.section.priority': { fr: 'Priorité', en: 'Priority' },
    'card.section.due': { fr: 'Échéance', en: 'Due date' },
    'card.section.tags': { fr: 'Tags', en: 'Tags' },
    'card.tags.add': { fr: 'Ajouter…', en: 'Add…' },
    'card.checklist.removeLine': {
        fr: 'Supprimer la ligne',
        en: 'Remove line',
    },
    'card.checklist.newItem': {
        fr: 'Nouvelle sous-tâche…',
        en: 'New subtask…',
    },
    'card.checklist.addItem': {
        fr: 'Ajouter une sous-tâche',
        en: 'Add a subtask',
    },
    'card.checklist.itemAria': { fr: 'Sous-tâche', en: 'Subtask' },
    'card.image.remove': { fr: 'Retirer l’image', en: 'Remove image' },
    'card.content.aria': { fr: 'Contenu', en: 'Content' },
    'card.content.placeholder': { fr: 'Écris ici…', en: 'Write here…' },
    'card.clickToEdit': { fr: 'Cliquer pour éditer', en: 'Click to edit' },
    'card.priority.none': { fr: 'Aucune', en: 'None' },
    'card.mentions.aria': { fr: 'Mentions', en: 'Mentions' },
    'card.mention.notFound': {
        fr: 'Aucune carte ne porte ce titre',
        en: 'No card has this title',
    },
    'card.backlinks': { fr: 'Cité par', en: 'Cited by' },
    'card.tool.linkActive': {
        fr: 'Cliquez une carte cible (Échap pour annuler)',
        en: 'Click a target card (Esc to cancel)',
    },
    'card.media.hint': {
        fr: '…ou colle / dépose une image sur la carte (max 1 Mo).',
        en: '…or paste / drop an image onto the card (max 1 MB).',
    },
    'card.color.swatch': { fr: 'Couleur {color}', en: 'Color {color}' },
    'card.text.swatch': { fr: 'Texte {color}', en: 'Text {color}' },
    'card.moveToDots': { fr: 'Déplacer vers…', en: 'Move to…' },
    'card.section.checklist': { fr: 'Checklist', en: 'Checklist' },
    'card.tags.remove': { fr: 'Retirer {tag}', en: 'Remove {tag}' },
    'card.image.alt': { fr: 'Image de la carte', en: 'Card image' },
    'card.goTo': { fr: 'Aller à « {title} »', en: 'Go to “{title}”' },
    // Card finishes (shared with the color popover).
    'finish.flat': { fr: 'Plat', en: 'Flat' },
    'finish.matte': { fr: 'Mat', en: 'Matte' },
    'finish.metallic': { fr: 'Métal', en: 'Metal' },
    'finish.glass': { fr: 'Verre', en: 'Glass' },
    'finish.paper': { fr: 'Papier', en: 'Paper' },
    // Text-style presets.
    'preset.yellow-note': { fr: 'Note jaune', en: 'Yellow note' },
    'preset.dark-neon': { fr: 'Sombre néon', en: 'Dark neon' },
    'preset.paper': { fr: 'Papier', en: 'Paper' },

    // --- connections ---------------------------------------------------------
    'link.label.placeholder': { fr: 'Libellé…', en: 'Label…' },
    'link.label.aria': { fr: 'Libellé du lien', en: 'Link label' },
    'link.label.commit': { fr: 'Valider le libellé', en: 'Confirm label' },
    'link.delete': { fr: 'Supprimer le lien', en: 'Delete link' },

    // --- notifications ------------------------------------------------------
    'notification.aria': { fr: 'Notifications', en: 'Notifications' },
    'notification.dismiss': {
        fr: 'Fermer la notification',
        en: 'Dismiss notification',
    },
    'notification.offline': {
        fr: 'Vous êtes hors ligne. Gardez cette page ouverte puis réessayez au retour du réseau.',
        en: 'You are offline. Keep this page open, then try again when the network returns.',
    },
    'notification.loadFailed': {
        fr: 'Certaines données du tableau n’ont pas pu être chargées. Réessayez dans un instant.',
        en: 'Some board data could not be loaded. Please try again in a moment.',
    },
    'notification.saveFailed': {
        fr: 'La modification n’a pas pu être enregistrée. Vérifiez votre connexion.',
        en: 'The change could not be saved. Check your connection.',
    },
    'notification.saveConflict': {
        fr: 'Cette carte a été modifiée ailleurs. Rechargez le tableau avant de réessayer.',
        en: 'This card was changed elsewhere. Reload the board before trying again.',
    },
    'notification.actionFailed': {
        fr: 'L’action n’a pas pu aboutir. Veuillez réessayer.',
        en: 'The action could not be completed. Please try again.',
    },
    'notification.searchFailed': {
        fr: 'La recherche globale est momentanément indisponible.',
        en: 'Global search is temporarily unavailable.',
    },

    // --- language switch -----------------------------------------------------
    'lang.switch.aria': { fr: 'Choisir la langue', en: 'Choose language' },
    'lang.fr': { fr: 'FR', en: 'FR' },
    'lang.en': { fr: 'EN', en: 'EN' },
} as const satisfies Record<string, TranslationEntry>;

export type TranslationKey = keyof typeof DICTIONARY;

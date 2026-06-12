/**
 * Factory : middleware de validation Joi
 * Valide req.body selon le schéma fourni
 */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false, // Retourner toutes les erreurs d'un coup
    stripUnknown: true // Supprimer les champs non définis dans le schéma
  });

  if (error) {
    const messages = error.details.map((d) => d.message);
    return res.status(422).json({
      success: false,
      message: 'Données invalides',
      errors: messages
    });
  }

  req.body = value; // Remplacer par la valeur assainie
  next();
};

module.exports = validate;
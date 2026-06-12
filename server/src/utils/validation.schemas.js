const Joi = require('joi');

const passwordRules = Joi.string()
  .min(8)
  .max(128)
  .pattern(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&\-_#])[A-Za-z\d@$!%*?&\-_#]+$/
  )
  .messages({
    'string.min': 'Le mot de passe doit contenir au moins 8 caractères',
    'string.max': 'Le mot de passe ne peut pas dépasser 128 caractères',
    'string.pattern.base': 'Le mot de passe doit contenir : une majuscule, une minuscule, un chiffre et un caractère spécial (@$!%*?&-_#)',
    'any.required': 'Le mot de passe est obligatoire'
  })
  .required();

const loginSchema = Joi.object({
  email: Joi.string()
    .email({ tlds: { allow: false } })
    .lowercase()
    .trim()
    .required()
    .messages({
      'string.email': "Format d'email invalide",
      'any.required': "L'email est obligatoire"
    }),
  password: Joi.string().required().messages({
    'any.required': 'Le mot de passe est obligatoire'
  })
});

const registerSchema = Joi.object({
  name: Joi.string()
    .min(2)
    .max(100)
    .trim()
    .required()
    .messages({
      'string.min': 'Le nom doit contenir au moins 2 caractères',
      'string.max': 'Le nom ne peut pas dépasser 100 caractères',
      'any.required': 'Le nom est obligatoire'
    }),
  email: Joi.string()
    .email({ tlds: { allow: false } })
    .lowercase()
    .trim()
    .required()
    .messages({
      'string.email': "Format d'email invalide",
      'any.required': "L'email est obligatoire"
    }),
  password: passwordRules,
  role: Joi.string()
    .valid('admin', 'rh', 'candidate')
    .default('candidate')
    .messages({
      'any.only': 'Rôle invalide. Valeurs autorisées : admin, rh, candidate'
    })
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required().messages({
    'any.required': 'Le refresh token est obligatoire'
  })
});

module.exports = { loginSchema, registerSchema, refreshTokenSchema };
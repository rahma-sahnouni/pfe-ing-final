'use strict';
// controllers/auth.controller.js

const crypto     = require('crypto');
const nodemailer = require('nodemailer');

const User = require('../models/user.model');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  buildTokenPayload,
} = require('../utils/jwt.utils');
const logger = require('../config/logger');

// ── Email transporter (auto-détecte dev vs prod) ──────────────────────────────

let _transporter = null;

async function getTransporter() {
  if (_transporter) return _transporter;

  if (process.env.NODE_ENV === 'production') {
    // ── PRODUCTION : utilise les variables SMTP de ton .env ──
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    // ── DÉVELOPPEMENT : Ethereal (faux SMTP, emails visibles sur ethereal.email) ──
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host:   'smtp.ethereal.email',
      port:   587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    logger.info(`📧 Ethereal SMTP prêt — compte: ${testAccount.user}`);
  }

  return _transporter;
}

// ── Helper ────────────────────────────────────────────────────────────────────
async function _appendRefreshToken(userId, existing, newToken) {
  const updated = [...(existing || []), newToken].slice(-5);
  await User.findByIdAndUpdate(userId, { refreshTokens: updated });
  return updated;
}

// ── Login ─────────────────────────────────────────────────────────────────────
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select(
      '+password +refreshTokens +loginAttempts +lockUntil'
    );
    if (!user) {
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: "Compte désactivé. Contactez l'administrateur." });
    }
    if (user.isLocked()) {
      const remainingMin = Math.ceil((user.lockUntil - Date.now()) / 60_000);
      return res.status(423).json({ success: false, message: `Compte temporairement verrouillé. Réessayez dans ${remainingMin} minute(s).` });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      await user.incLoginAttempts();
      logger.warn(`Failed login: ${email} (IP: ${req.ip})`);
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect.' });
    }

    await user.resetLoginAttempts();

    const payload      = buildTokenPayload(user);
    const accessToken  = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    await _appendRefreshToken(user._id, user.refreshTokens, refreshToken);
    logger.info(`Login: ${user.email} (role: ${user.role}) from IP: ${req.ip}`);

    return res.status(200).json({
      success: true,
      message: 'Connexion réussie.',
      accessToken,
      refreshToken,
      user: user.toSafeObject(),
    });
  } catch (err) { next(err); }
};

// ── Register ──────────────────────────────────────────────────────────────────
exports.register = async (req, res, next) => {
  try {
    const { email, password, role, name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Le nom doit contenir au moins 2 caractères.' });
    }
    if (await User.findOne({ email })) {
      return res.status(409).json({ success: false, message: 'Un compte avec cet email existe déjà.' });
    }

    const user = await User.create({ email, password, role, name: name.trim() });
    logger.info(`New account: ${user.email} (role: ${user.role})`);

    return res.status(201).json({ success: true, message: 'Compte créé avec succès.', user: user.toSafeObject() });
  } catch (err) { next(err); }
};

// ── Refresh token ─────────────────────────────────────────────────────────────
exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;

    let decoded;
    try { decoded = verifyRefreshToken(token); }
    catch {
      return res.status(401).json({ success: false, message: 'Refresh token invalide ou expiré. Veuillez vous reconnecter.' });
    }

    const user = await User.findById(decoded.sub).select('+refreshTokens');
    if (!user || !user.refreshTokens.includes(token)) {
      if (user) {
        await User.findByIdAndUpdate(user._id, { refreshTokens: [] });
        logger.warn(`Token reuse attack suspected for ${user.email}`);
      }
      return res.status(401).json({ success: false, message: 'Token invalide. Toutes les sessions ont été révoquées.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Compte désactivé.' });
    }

    const payload         = buildTokenPayload(user);
    const newAccessToken  = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);

    const updatedTokens = user.refreshTokens.filter(t => t !== token).concat(newRefreshToken).slice(-5);
    await User.findByIdAndUpdate(user._id, { refreshTokens: updatedTokens });

    return res.status(200).json({ success: true, accessToken: newAccessToken, refreshToken: newRefreshToken, user: user.toSafeObject() });
  } catch (err) { next(err); }
};

// ── Logout ────────────────────────────────────────────────────────────────────
exports.logout = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;
    if (token) await User.findByIdAndUpdate(req.user._id, { $pull: { refreshTokens: token } });
    logger.info(`Logout: ${req.user.email}`);
    return res.status(200).json({ success: true, message: 'Déconnexion réussie.' });
  } catch (err) { next(err); }
};

exports.logoutAll = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { refreshTokens: [] });
    logger.info(`Logout all devices: ${req.user.email}`);
    return res.status(200).json({ success: true, message: 'Déconnecté de tous les appareils.' });
  } catch (err) { next(err); }
};

// ── Profile ───────────────────────────────────────────────────────────────────
exports.getMe = (req, res) => {
  return res.status(200).json({ success: true, user: req.user.toSafeObject ? req.user.toSafeObject() : req.user });
};

exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both passwords are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    if (!(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    user.password = newPassword;
    await user.save();

    logger.info(`Password changed: ${user.email}`);
    return res.status(200).json({ success: true, message: 'Password updated successfully.' });
  } catch (err) { next(err); }
};

// ── Forgot password ───────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email requis.' });
    }

    const SAFE_RESPONSE = {
      success: true,
      message: 'Si cet email existe, vous recevrez un lien de réinitialisation.',
    };

    const user = await User.findOne({ email });
    if (!user) return res.status(200).json(SAFE_RESPONSE);

    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 10 * 60_000); // 10 min

    await User.findByIdAndUpdate(user._id, {
      passwordResetToken:   token,
      passwordResetExpires: expires,
    });

    const resetLink = `${process.env.FRONTEND_URL}/auth/reset-password?token=${token}`;

    const transport = await getTransporter();
    const info = await transport.sendMail({
      from:    `"Nexus Peak" <${process.env.SMTP_FROM || 'noreply@nexuspeak.com'}>`,
      to:      user.email,
      subject: 'Réinitialisation de votre mot de passe',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;">
          <h2 style="color:#1a1a2e;">Bonjour ${user.name || user.email}</h2>
          <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
          <p>Cliquez sur le bouton ci-dessous (lien valable <strong>10 minutes</strong>) :</p>
          <a href="${resetLink}"
             style="display:inline-block;background:#7c3aed;color:white;
                    padding:12px 28px;text-decoration:none;border-radius:8px;
                    font-weight:600;margin:16px 0;">
            Réinitialiser mon mot de passe
          </a>
          <p style="color:#888;font-size:13px;margin-top:24px;">
            Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.
          </p>
        </div>
      `,
    });

    // En dev : log le lien Ethereal pour voir l'email sans vrai SMTP
    if (process.env.NODE_ENV !== 'production') {
      logger.info(`📧 Email de reset (dev) — voir sur : ${nodemailer.getTestMessageUrl(info)}`);
      logger.info(`🔗 Lien de reset direct : ${resetLink}`);
    }

    logger.info(`Reset password email envoyé à ${user.email}`);
    return res.status(200).json(SAFE_RESPONSE);
  } catch (err) { next(err); }
};

// ── Reset password ────────────────────────────────────────────────────────────
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'Token et nouveau mot de passe requis.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Le mot de passe doit contenir au moins 8 caractères.' });
    }

    const user = await User.findOne({
      passwordResetToken:   token,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Token invalide ou expiré.' });
    }

    user.password             = newPassword;
    user.passwordResetToken   = null;
    user.passwordResetExpires = null;
    await user.save();

    await User.findByIdAndUpdate(user._id, { refreshTokens: [] });

    logger.info(`Mot de passe réinitialisé pour ${user.email}`);
    return res.status(200).json({
      success: true,
      message: 'Votre mot de passe a été mis à jour. Vous pouvez maintenant vous connecter.',
    });
  } catch (err) { next(err); }
};
async function getTransporter() {
  if (_transporter) return _transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    logger.info(`📧 Ethereal SMTP prêt — compte: ${testAccount.user}`);
  }

  return _transporter;
}
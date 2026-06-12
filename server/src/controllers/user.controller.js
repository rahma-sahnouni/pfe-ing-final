const User = require('../models/user.model');

// ─────────────────────────────────────────────
// GET USERS (RH + Admin only)
// ─────────────────────────────────────────────
exports.getUsers = async (req, res) => {
  try {
    const users = await User
      .find()                     // plus de filtre, prend tout le monde
      .sort({ createdAt: -1 });   // tri par date de création décroissante

    const formatted = users.map(u => ({
      id:        u._id,
      email:     u.email,
      name:      u.name,
      role:      u.role,          // renvoie le rôle tel quel
      isActive:  u.isActive,
      lastLogin: u.lastLogin,
      createdAt: u.createdAt,
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// ─────────────────────────────────────────────
// CREATE USER (Admin)
// ─────────────────────────────────────────────
exports.createUser = async (req, res) => {
  try {
    const { email, password, role, name, phone, jobOffer, experience } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ message: 'email, password and role are required' });
    }

    const allowedRoles = ['admin', 'rh', 'candidate', 'technical evaluator'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: `Invalid role. Must be one of: ${allowedRoles.join(', ')}` });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Email already exists' });

    // ✅ Include name for ALL roles, not just candidates
    const userData = { email, password, role, name: name?.trim() || null };

    if (role === 'candidate') {
      userData.phone       = phone;
      userData.jobOffer    = jobOffer;
      userData.experience  = experience ?? 0;
      userData.appliedDate = new Date();
      userData.status      = 'Pending';
    }

    const user = new User(userData);
    await user.save();
    res.status(201).json(user.toSafeObject());
  } catch (error) {
    console.error('[createUser] Error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(422).json({ message: 'Validation failed', errors: messages });
    }

    res.status(500).json({ message: error.message });
  }
};


// ─────────────────────────────────────────────
// GET CURRENT USER
// ─────────────────────────────────────────────
exports.getCurrentUser = async (req, res) => {
  try {
    const { _id, email, role, isActive } = req.user;
    res.json({ id: _id, email, role, isActive });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// DELETE USER
// ─────────────────────────────────────────────
exports.deleteUser = async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
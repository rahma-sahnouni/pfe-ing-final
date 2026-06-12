const express = require('express');
const router = express.Router();
const controller = require('../controllers/user.controller');
const { authenticate, authorize } = require('../middlewares/auth.middleware');

// ⚠️  Routes statiques TOUJOURS avant /:id
router.get('/me',                  authenticate, controller.getCurrentUser);

// Routes admin
router.get('/',    authenticate, authorize('admin', 'rh'), controller.getUsers);
router.post('/',   authenticate, authorize('admin'),       controller.createUser);
router.delete('/:id', authenticate, authorize('admin'),    controller.deleteUser);

module.exports = router;
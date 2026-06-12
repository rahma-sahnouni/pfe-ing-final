const express = require("express");
const router = express.Router();

const jobController = require("../controllers/jobOffer.controller");
const { authenticate, authorize } = require("../middlewares/auth.middleware");

// Add BEFORE the :id routes so they don't get swallowed
router.get('/my-rh-tests',  authenticate, authorize("admin","rh" , "technical evaluator"), jobController.getMyRhTestJobs);
router.get('/my-tech-tests', authenticate, authorize("admin","rh" , "technical evaluator"), jobController.getMyTechTestJobs);
// routes/jobOffer.routes.js
router.get('/accessible', authenticate, jobController.getAccessibleJobs);
router.get('/my-jobs', authenticate, jobController.getMyJobs);
// voir toutes les offres
router.get("/", jobController.getJobs);

// voir une offre
router.get("/:id", jobController.getJobById);

// créer une offre → RH ou Admin
router.post("/", authenticate, authorize("admin","rh"), jobController.createJob);

// modifier une offre → RH ou Admin
router.put("/:id", authenticate, authorize("admin","rh"), jobController.updateJob);

// supprimer une offre → Admin
router.delete("/:id", authenticate, authorize("admin","rh"), jobController.deleteJob);


module.exports = router;
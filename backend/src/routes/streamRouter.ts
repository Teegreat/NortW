import { Router } from "express";
import { createStreamToken } from "../controllers/streamController";

const router = Router()

router.post("/", createStreamToken)

export default router

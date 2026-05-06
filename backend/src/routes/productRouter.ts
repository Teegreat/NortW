import { Router } from "express";
import { getCategories, getProductBySlug, listProducts } from "../controllers/productController";

const router = Router()

// allow users to get product
router.get('/', listProducts)
router.get("/categories", getCategories);
router.get("/:slug", getProductBySlug);

export default router;
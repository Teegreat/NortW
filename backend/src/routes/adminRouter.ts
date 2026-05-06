import { Router } from "express";
import { createAdminProduct, deleteAdminProduct, getImageKitAuth, listAdminProducts, requireAdmin, updateAdminProduct } from "../controllers/adminController";


const router = Router()

router.use(requireAdmin)

router.get('/imagekit.auth', getImageKitAuth)
router.get("/products", listAdminProducts);
router.post("/:products", createAdminProduct);
router.post("/:products/:id", updateAdminProduct);
router.post("/:products/:id", deleteAdminProduct);

export default router
import type { Request, Response, NextFunction } from "express";
import { getEnv } from "../lib/env";
import z from "zod";
import { getAuth } from "@clerk/express";
import { getLocalUser } from "../lib/users";
import { db } from "../db";
import { CheckoutSessionLine, checkoutSessions, products } from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { polarCreateCheckout } from "../lib/polar";

const env = getEnv();

const cartSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

export async function createCheckout(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    // only signed in users can start checkout
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsedData = cartSchema.safeParse(req.body);

    if (!parsedData.success) {
      res
        .status(400)
        .json({ error: "Invalid cart", details: parsedData.error.flatten() });
      return;
    }

    // Polar access token required
    if (!env.POLAR_ACCESS_TOKEN) {
      res.status(503).json({ error: "Payments are not configured" });
      return;
    }

    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res.status(503).json({
        error: "Account not synced yet",
      });
      return;
    }

    const ids = parsedData.data.items.map((item) => item.productId);

    // load every cart product that exists, is active and matches the IDs we aked for
    const prodRows = await db
      .select()
      .from(products)
      .where(and(inArray(products.id, ids), eq(products.active, true)));

    if (prodRows.length !== ids.length) {
      res.status(400).json({
        error: "One or more products are invalid",
      });
      return;
    }

    // calculate price
    const byId = new Map(prodRows.map((prod) => [prod.id, prod]));

    let totalCents = 0;

    const lines: CheckoutSessionLine[] = [];

    for (const line of parsedData.data.items) {
      const product = byId.get(line.productId)!;
      totalCents += product.priceCents * line.quantity;
      lines.push({
        productId: product.id,
        quantity: line.quantity,
        unitPriceCents: product.priceCents,
      });
    }

    if (totalCents <= 10) {
      res.status(400).json({
        error:
          "Total below Polar minimum (e.g. USD required at least 10 cents)",
      });
      return;
    }

    // create checkout session
    const [session] = await db
      .insert(checkoutSessions)
      .values({
        userId: localUser.id,
        totalCents,
        lines,
        currency: "usd",
      })
      .returning();

    const successUrl = `${env.FRONTEND_URL}/checkout/return?checkout_id={CHECKOUT_ID}`;

    const returnUrl = `${env.FRONTEND_URL}/cart`;

    const checkout = await polarCreateCheckout(env, {
      products: [env.POLAR_CHECKOUT_PRODUCT_ID],
      prices: {
        [env.POLAR_CHECKOUT_PRODUCT_ID]: [
          {
            amount_type: "fixed",
            price_currency: "usd",
            price_amount: totalCents,
          },
        ],
      },
      success_url: successUrl,
      return_url: returnUrl,
      external_customer_id: userId,
      metadata: {
        checkout_session_id: session.id,
      },
    });

    await db
      .update(checkoutSessions)
      .set({
        polarCheckoutId: checkout.id,
      })
      .where(eq(checkoutSessions.id, session.id));

    res.json({ chekoutUrl: checkout.url });
  } catch (e) {
    next(e);
  }
}
